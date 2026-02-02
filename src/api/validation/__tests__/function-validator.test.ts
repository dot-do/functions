/**
 * Function Validator Tests
 *
 * Comprehensive tests for the FunctionValidator class and re-exported
 * validation utilities from function-validator.ts.
 *
 * Tests cover:
 * - FunctionValidator.validateSafe() (Result-returning)
 * - FunctionValidator.validate() (legacy throwing)
 * - Re-exported utility functions (isValidVersion, parseVersion)
 * - Re-exported Result helpers (ok, err, isOk, isErr)
 * - Valid/invalid function IDs, versions, languages, code, entry points, dependencies
 * - Edge cases: empty strings, boundary lengths, special characters
 */

import { describe, it, expect } from 'vitest'
import {
  FunctionValidator,
  isOk,
  isErr,
  ok,
  err,
  isValidVersion,
  parseVersion,
  validateFunctionIdSafe,
  validateLanguageSafe,
  validateEntryPointSafe,
  validateDependenciesSafe,
  validateVersionSafe,
  validateFunctionId,
  validateLanguage,
  validateEntryPoint,
  validateDependencies,
  type FunctionValidationInput,
} from '../function-validator'
import { ValidationError } from '../../../core/errors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid input for FunctionValidator */
function validInput(overrides: Partial<FunctionValidationInput> = {}): FunctionValidationInput {
  return {
    id: 'my-func',
    version: '1.0.0',
    language: 'typescript',
    ...overrides,
  }
}

// ===========================================================================
// FunctionValidator.validateSafe()  (Result-returning, preferred API)
// ===========================================================================

describe('FunctionValidator.validateSafe()', () => {
  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  describe('valid inputs', () => {
    it('should accept minimal valid metadata', () => {
      const result = FunctionValidator.validateSafe(validInput())
      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.data.id).toBe('my-func')
        expect(result.data.version).toBe('1.0.0')
        expect(result.data.language).toBe('typescript')
      }
    })

    it('should accept metadata with all optional fields', () => {
      const input = validInput({
        code: 'export default () => "hello"',
        entryPoint: 'src/index.ts',
        dependencies: { lodash: '^4.17.21' },
      })
      const result = FunctionValidator.validateSafe(input)
      expect(isOk(result)).toBe(true)
    })

    it('should accept every supported language', () => {
      const languages = ['typescript', 'javascript', 'rust', 'python', 'go', 'zig', 'assemblyscript', 'csharp']
      for (const lang of languages) {
        const result = FunctionValidator.validateSafe(validInput({ language: lang }))
        expect(isOk(result)).toBe(true)
      }
    })

    it('should accept valid semver with prerelease', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '1.0.0-beta.1' }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept valid semver with build metadata', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '1.0.0+build.123' }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept valid semver with prerelease and build', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '2.3.4-alpha.1+build.456' }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept metadata without optional code field', () => {
      const result = FunctionValidator.validateSafe(validInput({ code: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept metadata without optional entryPoint field', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept metadata without optional dependencies field', () => {
      const result = FunctionValidator.validateSafe(validInput({ dependencies: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept non-empty code string', () => {
      const result = FunctionValidator.validateSafe(validInput({ code: 'console.log("hi")' }))
      expect(isOk(result)).toBe(true)
    })

    it('should pass through the original input on success', () => {
      const input = validInput({ code: 'abc', entryPoint: 'index.ts', dependencies: { a: '1.0.0' } })
      const result = FunctionValidator.validateSafe(input)
      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.data).toBe(input) // same reference
      }
    })
  })

  // -------------------------------------------------------------------------
  // Invalid function IDs
  // -------------------------------------------------------------------------

  describe('invalid function IDs', () => {
    it('should reject empty ID', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: '' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(ValidationError)
        expect(result.error.message).toContain('ID is required')
      }
    })

    it('should reject ID longer than 64 characters', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'a'.repeat(65) }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('64 characters or less')
      }
    })

    it('should accept ID of exactly 64 characters', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'a'.repeat(64) }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept single-character ID', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'a' }))
      expect(isOk(result)).toBe(true)
    })

    it('should reject ID starting with a number', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: '1abc' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('must start with a letter')
      }
    })

    it('should reject ID starting with a hyphen', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: '-abc' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject ID ending with a hyphen', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'abc-' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('cannot start or end with hyphen or underscore')
      }
    })

    it('should reject ID ending with an underscore', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'abc_' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject ID with consecutive hyphens', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'my--func' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('consecutive hyphens or underscores')
      }
    })

    it('should reject ID with consecutive underscores', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'my__func' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject ID with special characters', () => {
      const specialChars = ['my.func', 'my func', 'my@func', 'my$func', 'my!func', 'my#func']
      for (const id of specialChars) {
        const result = FunctionValidator.validateSafe(validInput({ id }))
        expect(isErr(result)).toBe(true)
      }
    })

    it('should accept ID with mixed case letters', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'MyFunc' }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept ID with underscores between words', () => {
      const result = FunctionValidator.validateSafe(validInput({ id: 'my_func_v2' }))
      expect(isOk(result)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Invalid versions
  // -------------------------------------------------------------------------

  describe('invalid versions', () => {
    it('should reject empty version', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('version is required')
      }
    })

    it('should reject non-semver version string', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: 'latest' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid semantic version')
      }
    })

    it('should reject version with v prefix', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: 'v1.0.0' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject two-part version', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '1.0' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject four-part version', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '1.0.0.0' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject version with leading zeros', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: '01.0.0' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject plain text version', () => {
      const result = FunctionValidator.validateSafe(validInput({ version: 'release' }))
      expect(isErr(result)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Invalid languages
  // -------------------------------------------------------------------------

  describe('invalid languages', () => {
    it('should reject empty language', () => {
      const result = FunctionValidator.validateSafe(validInput({ language: '' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('language is required')
      }
    })

    it('should reject unsupported language', () => {
      const result = FunctionValidator.validateSafe(validInput({ language: 'java' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('must be one of')
      }
    })

    it('should reject language with wrong case', () => {
      const result = FunctionValidator.validateSafe(validInput({ language: 'TypeScript' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject language with whitespace', () => {
      const result = FunctionValidator.validateSafe(validInput({ language: ' typescript ' }))
      expect(isErr(result)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Code field validation
  // -------------------------------------------------------------------------

  describe('code field validation', () => {
    it('should reject empty string code when code is provided', () => {
      const result = FunctionValidator.validateSafe(validInput({ code: '' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('Code cannot be empty')
      }
    })

    it('should accept undefined code (field not present)', () => {
      const result = FunctionValidator.validateSafe(validInput({ code: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept whitespace-only code (non-empty string)', () => {
      const result = FunctionValidator.validateSafe(validInput({ code: '   ' }))
      expect(isOk(result)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Entry point validation
  // -------------------------------------------------------------------------

  describe('entry point validation', () => {
    it('should accept valid relative path', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: 'src/index.ts' }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept simple filename', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: 'index.ts' }))
      expect(isOk(result)).toBe(true)
    })

    it('should reject absolute path entry point', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: '/src/index.ts' }))
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('relative path')
      }
    })

    it('should reject entry point with parent directory traversal', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: '../index.ts' }))
      expect(isErr(result)).toBe(true)
    })

    it('should reject entry point with double slashes', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: 'src//index.ts' }))
      expect(isErr(result)).toBe(true)
    })

    it('should skip entry point validation when undefined', () => {
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should skip entry point validation when empty string (falsy)', () => {
      // entryPoint is checked with `if (metadata.entryPoint)` which is falsy for ''
      const result = FunctionValidator.validateSafe(validInput({ entryPoint: '' }))
      expect(isOk(result)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Dependencies validation
  // -------------------------------------------------------------------------

  describe('dependencies validation', () => {
    it('should accept valid dependencies', () => {
      const result = FunctionValidator.validateSafe(
        validInput({ dependencies: { lodash: '^4.17.21', axios: '~1.6.0' } })
      )
      expect(isOk(result)).toBe(true)
    })

    it('should accept empty dependencies object', () => {
      const result = FunctionValidator.validateSafe(validInput({ dependencies: {} }))
      expect(isOk(result)).toBe(true)
    })

    it('should skip dependencies validation when undefined', () => {
      const result = FunctionValidator.validateSafe(validInput({ dependencies: undefined }))
      expect(isOk(result)).toBe(true)
    })

    it('should accept wildcard and latest versions', () => {
      const result = FunctionValidator.validateSafe(
        validInput({ dependencies: { pkg1: '*', pkg2: 'latest' } })
      )
      expect(isOk(result)).toBe(true)
    })

    it('should accept range versions', () => {
      const result = FunctionValidator.validateSafe(
        validInput({ dependencies: { pkg: '1.0.0 - 2.0.0' } })
      )
      expect(isOk(result)).toBe(true)
    })

    it('should reject dependency with invalid semver version', () => {
      const result = FunctionValidator.validateSafe(
        validInput({ dependencies: { lodash: 'invalid' } })
      )
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('invalid semver version')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Validation order (first error wins)
  // -------------------------------------------------------------------------

  describe('validation order', () => {
    it('should report ID error before version error', () => {
      const result = FunctionValidator.validateSafe({
        id: '',
        version: 'bad',
        language: 'nope',
      })
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('ID is required')
      }
    })

    it('should report version error before language error when ID is valid', () => {
      const result = FunctionValidator.validateSafe({
        id: 'ok',
        version: 'bad',
        language: 'nope',
      })
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid semantic version')
      }
    })

    it('should report language error when ID and version are valid', () => {
      const result = FunctionValidator.validateSafe({
        id: 'ok',
        version: '1.0.0',
        language: 'nope',
      })
      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('must be one of')
      }
    })
  })
})

// ===========================================================================
// FunctionValidator.validate()  (legacy throwing API)
// ===========================================================================

describe('FunctionValidator.validate()', () => {
  it('should return valid:true and empty errors for valid input', () => {
    const { valid, errors } = FunctionValidator.validate(validInput())
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('should return valid:true with all optional fields', () => {
    const { valid, errors } = FunctionValidator.validate(
      validInput({
        code: 'export default {}',
        entryPoint: 'index.ts',
        dependencies: { lodash: '^4.17.21' },
      })
    )
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('should collect error for invalid ID', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ id: '' }))
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('Invalid function ID'))).toBe(true)
  })

  it('should collect error for invalid version', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ version: 'bad' }))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('Invalid semantic version'))).toBe(true)
  })

  it('should collect error for invalid language', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ language: 'ruby' }))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('Invalid language'))).toBe(true)
  })

  it('should collect error for empty code string', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ code: '' }))
    expect(valid).toBe(false)
    expect(errors).toContain('Code cannot be empty')
  })

  it('should collect error for invalid entry point', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ entryPoint: '/abs/path.ts' }))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('Invalid entry point'))).toBe(true)
  })

  it('should collect error for invalid dependencies', () => {
    const { valid, errors } = FunctionValidator.validate(
      validInput({ dependencies: { pkg: 'not-semver' } })
    )
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('Invalid dependencies') || e.includes('invalid semver'))).toBe(true)
  })

  it('should collect multiple errors at once', () => {
    const { valid, errors } = FunctionValidator.validate({
      id: '',
      version: 'bad',
      language: 'nope',
      code: '',
      entryPoint: '/abs.ts',
      dependencies: { pkg: 'nope' },
    })
    expect(valid).toBe(false)
    // Should have errors for ID, version, language, and code at minimum
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })

  it('should not include entry point error when entry point is undefined', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ entryPoint: undefined }))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('should not include dependencies error when dependencies is undefined', () => {
    const { valid, errors } = FunctionValidator.validate(validInput({ dependencies: undefined }))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })
})

// ===========================================================================
// Re-exported standalone validators (Safe / Result-returning)
// ===========================================================================

describe('Re-exported Safe validators', () => {
  describe('validateFunctionIdSafe()', () => {
    it('should return ok for valid ID', () => {
      const result = validateFunctionIdSafe('hello')
      expect(isOk(result)).toBe(true)
    })

    it('should return err for empty ID', () => {
      const result = validateFunctionIdSafe('')
      expect(isErr(result)).toBe(true)
    })
  })

  describe('validateVersionSafe()', () => {
    it('should return ok for valid semver', () => {
      const result = validateVersionSafe('0.0.1')
      expect(isOk(result)).toBe(true)
    })

    it('should return err for invalid version', () => {
      const result = validateVersionSafe('abc')
      expect(isErr(result)).toBe(true)
    })
  })

  describe('validateLanguageSafe()', () => {
    it('should return ok for valid language', () => {
      const result = validateLanguageSafe('python')
      expect(isOk(result)).toBe(true)
    })

    it('should return err for unsupported language', () => {
      const result = validateLanguageSafe('perl')
      expect(isErr(result)).toBe(true)
    })
  })

  describe('validateEntryPointSafe()', () => {
    it('should return ok for valid entry point', () => {
      const result = validateEntryPointSafe('main.py')
      expect(isOk(result)).toBe(true)
    })

    it('should return err for empty entry point', () => {
      const result = validateEntryPointSafe('')
      expect(isErr(result)).toBe(true)
    })
  })

  describe('validateDependenciesSafe()', () => {
    it('should return ok for valid dependencies', () => {
      const result = validateDependenciesSafe({ lodash: '^4.17.21' })
      expect(isOk(result)).toBe(true)
    })

    it('should return ok for undefined', () => {
      const result = validateDependenciesSafe(undefined)
      expect(isOk(result)).toBe(true)
    })

    it('should return err for array input', () => {
      const result = validateDependenciesSafe(['lodash'])
      expect(isErr(result)).toBe(true)
    })
  })
})

// ===========================================================================
// Re-exported throwing validators
// ===========================================================================

describe('Re-exported throwing validators', () => {
  it('validateFunctionId should throw for invalid ID', () => {
    expect(() => validateFunctionId('')).toThrow()
  })

  it('validateFunctionId should not throw for valid ID', () => {
    expect(() => validateFunctionId('ok')).not.toThrow()
  })

  it('validateLanguage should throw for unsupported language', () => {
    expect(() => validateLanguage('java')).toThrow()
  })

  it('validateLanguage should not throw for supported language', () => {
    expect(() => validateLanguage('rust')).not.toThrow()
  })

  it('validateEntryPoint should throw for invalid path', () => {
    expect(() => validateEntryPoint('')).toThrow()
  })

  it('validateEntryPoint should not throw for valid path', () => {
    expect(() => validateEntryPoint('index.ts')).not.toThrow()
  })

  it('validateDependencies should throw for non-object', () => {
    expect(() => validateDependencies(42)).toThrow()
  })

  it('validateDependencies should not throw for valid object', () => {
    expect(() => validateDependencies({ a: '1.0.0' })).not.toThrow()
  })
})

// ===========================================================================
// Re-exported utilities: isValidVersion, parseVersion
// ===========================================================================

describe('Re-exported version utilities', () => {
  describe('isValidVersion()', () => {
    it('should return true for standard semver', () => {
      expect(isValidVersion('1.0.0')).toBe(true)
      expect(isValidVersion('0.1.0')).toBe(true)
      expect(isValidVersion('10.20.30')).toBe(true)
    })

    it('should return true for semver with prerelease', () => {
      expect(isValidVersion('1.0.0-alpha')).toBe(true)
      expect(isValidVersion('1.0.0-beta.2')).toBe(true)
    })

    it('should return true for semver with build metadata', () => {
      expect(isValidVersion('1.0.0+build')).toBe(true)
    })

    it('should return false for non-semver strings', () => {
      expect(isValidVersion('')).toBe(false)
      expect(isValidVersion('abc')).toBe(false)
      expect(isValidVersion('1.0')).toBe(false)
      expect(isValidVersion('v1.0.0')).toBe(false)
    })
  })

  describe('parseVersion()', () => {
    it('should parse valid version into components', () => {
      const parsed = parseVersion('2.3.4')
      expect(parsed).toEqual({ major: 2, minor: 3, patch: 4 })
    })

    it('should parse version with prerelease', () => {
      const parsed = parseVersion('1.0.0-rc.1')
      expect(parsed).not.toBeNull()
      expect(parsed!.prerelease).toBe('rc.1')
    })

    it('should return null for invalid version', () => {
      expect(parseVersion('nope')).toBeNull()
    })
  })
})

// ===========================================================================
// Re-exported Result helpers: ok, err, isOk, isErr
// ===========================================================================

describe('Re-exported Result helpers', () => {
  it('ok() should create a successful result', () => {
    const result = ok('hello')
    expect(result.success).toBe(true)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.data).toBe('hello')
    }
  })

  it('err() should create a failed result', () => {
    const error = new ValidationError('test error')
    const result = err(error)
    expect(result.success).toBe(false)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.message).toBe('test error')
    }
  })

  it('isOk and isErr should be mutually exclusive', () => {
    const success = ok(42)
    const failure = err(new ValidationError('fail'))
    expect(isOk(success)).toBe(true)
    expect(isErr(success)).toBe(false)
    expect(isOk(failure)).toBe(false)
    expect(isErr(failure)).toBe(true)
  })
})

// ===========================================================================
// Default export
// ===========================================================================

describe('default export', () => {
  it('should be the FunctionValidator class', async () => {
    const mod = await import('../function-validator')
    expect(mod.default).toBe(FunctionValidator)
  })
})
