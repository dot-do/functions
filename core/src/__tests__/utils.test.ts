import { describe, it, expect } from 'vitest'
import { assertNever } from '../utils.js'

describe('assertNever', () => {
  it('should throw an error when called with any value', () => {
    expect(() => assertNever('test' as never)).toThrow()
    expect(() => assertNever(123 as never)).toThrow()
    expect(() => assertNever({} as never)).toThrow()
  })

  it('should include value in error message when custom message not provided', () => {
    const value = 'unexpected'
    expect(() => assertNever(value as never)).toThrow(/Unexpected value/)
  })

  it('should use custom message when provided', () => {
    const customMessage = 'Custom error message'
    expect(() => assertNever('test' as never, customMessage)).toThrow(customMessage)
  })

  it('should have return type of never for exhaustive checking', () => {
    // This test validates the TypeScript type at compile time
    type Status = 'active' | 'inactive'
    const status: Status = 'active'

    const handleStatus = (s: Status): string => {
      switch (s) {
        case 'active':
          return 'Active'
        case 'inactive':
          return 'Inactive'
        default:
          return assertNever(s)
      }
    }

    expect(handleStatus('active')).toBe('Active')
    expect(handleStatus('inactive')).toBe('Inactive')
  })

  it('should enable exhaustive checking in switch statements', () => {
    // This example demonstrates that adding a new status value
    // to the Status type would cause a TypeScript error
    // if the switch statement is not updated
    type Action = 'CREATE' | 'UPDATE' | 'DELETE'
    const action: Action = 'CREATE'

    const performAction = (a: Action): string => {
      switch (a) {
        case 'CREATE':
          return 'Creating'
        case 'UPDATE':
          return 'Updating'
        case 'DELETE':
          return 'Deleting'
        default:
          return assertNever(a)
      }
    }

    expect(performAction('CREATE')).toBe('Creating')
    expect(performAction('UPDATE')).toBe('Updating')
    expect(performAction('DELETE')).toBe('Deleting')
  })
})
