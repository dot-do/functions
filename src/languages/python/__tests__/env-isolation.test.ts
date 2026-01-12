/**
 * Environment Variable Isolation Tests (RED PHASE)
 *
 * These tests verify that Python subprocess execution properly isolates
 * environment variables, preventing sensitive data from leaking to user code.
 *
 * SECURITY CONCERN: The current implementation passes ALL environment variables
 * to the subprocess via `{ ...process.env, PYTHONIOENCODING: 'utf-8' }`.
 * This is a security vulnerability as it exposes sensitive values like:
 * - SECRET_KEY, API_KEY, AUTH_TOKEN
 * - DATABASE_URL, REDIS_URL
 * - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * - Any other secrets in the process environment
 *
 * EXPECTED BEHAVIOR: Only a whitelist of safe environment variables should
 * be passed to the subprocess:
 * - PATH (for finding Python executable)
 * - HOME (for Python user-level config)
 * - PYTHONIOENCODING (for proper encoding handling)
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the current implementation leaks all environment variables.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invokePython } from '../invoke'

describe('Python Subprocess Environment Isolation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset process.env before each test by creating a new object
    // with only the essential variables needed for Python to run
    process.env = {
      PATH: originalEnv.PATH,
      HOME: originalEnv.HOME,
      // Add mock sensitive values that should NOT leak
      SECRET_KEY: 'super-secret-key-12345',
      DATABASE_URL: 'postgres://user:password@localhost:5432/db',
      API_KEY: 'api-key-abcdef-123456',
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      AUTH_TOKEN: 'bearer-token-xyz-789',
      STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop',
      REDIS_URL: 'redis://:password@localhost:6379/0',
      OPENAI_API_KEY: 'sk-proj-abcdefghijklmnop',
      GITHUB_TOKEN: 'ghp_xxxxxxxxxxxx',
    }
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv
  })

  describe('Sensitive Variable Blocking', () => {
    it('should NOT pass SECRET_KEY to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('SECRET_KEY', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      // If isolation is working, SECRET_KEY should not be available
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass DATABASE_URL to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('DATABASE_URL', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass API_KEY to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('API_KEY', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass AWS credentials to subprocess', async () => {
      const code = `
import os

def handler():
    access_key = os.environ.get('AWS_ACCESS_KEY_ID', 'NOT_FOUND')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY', 'NOT_FOUND')
    return {'access_key': access_key, 'secret_key': secret_key}
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual({
        access_key: 'NOT_FOUND',
        secret_key: 'NOT_FOUND',
      })
    })

    it('should NOT pass AUTH_TOKEN to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('AUTH_TOKEN', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass STRIPE_SECRET_KEY to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('STRIPE_SECRET_KEY', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass REDIS_URL to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('REDIS_URL', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass OPENAI_API_KEY to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('OPENAI_API_KEY', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should NOT pass GITHUB_TOKEN to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('GITHUB_TOKEN', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })
  })

  describe('Whitelisted Variable Allowance', () => {
    it('should pass PATH to subprocess', async () => {
      const code = `
import os

def handler():
    path = os.environ.get('PATH', 'NOT_FOUND')
    return path != 'NOT_FOUND'
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe(true)
    })

    it('should pass HOME to subprocess', async () => {
      const code = `
import os

def handler():
    home = os.environ.get('HOME', 'NOT_FOUND')
    return home != 'NOT_FOUND'
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe(true)
    })

    it('should pass PYTHONIOENCODING to subprocess', async () => {
      const code = `
import os

def handler():
    return os.environ.get('PYTHONIOENCODING', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('utf-8')
    })
  })

  describe('Environment Enumeration Prevention', () => {
    it('should only expose whitelisted and system-essential environment variables', async () => {
      const code = `
import os

def handler():
    # Get all environment variable names
    env_vars = list(os.environ.keys())
    return sorted(env_vars)
`
      const result = await invokePython(code, 'handler', [])
      // Our explicitly whitelisted variables
      const allowedVars = ['PATH', 'HOME', 'PYTHONIOENCODING']
      // System-essential variables that may be injected by macOS/Linux
      const systemVars = ['CPATH', 'LC_CTYPE', 'LIBRARY_PATH', 'MANPATH', 'SDKROOT', '__CF_USER_TEXT_ENCODING', 'TERM', 'LANG', 'USER', 'SHELL', 'TMPDIR', 'LOGNAME']
      const allAllowedVars = [...allowedVars, ...systemVars]

      // The result should only contain whitelisted or system-essential variables
      expect(Array.isArray(result)).toBe(true)
      for (const varName of result as string[]) {
        expect(allAllowedVars).toContain(varName)
      }
      // Our whitelisted variables should be present
      expect(result).toContain('PATH')
      expect(result).toContain('HOME')
      expect(result).toContain('PYTHONIOENCODING')
    })

    it('should not leak any sensitive variables through os.environ enumeration', async () => {
      const code = `
import os

def handler():
    sensitive_patterns = ['SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'URL', 'AWS', 'STRIPE', 'REDIS', 'OPENAI', 'GITHUB']
    leaked = []
    for var_name in os.environ.keys():
        for pattern in sensitive_patterns:
            if pattern in var_name.upper():
                leaked.append(var_name)
                break
    return leaked
`
      const result = await invokePython(code, 'handler', [])
      // No sensitive variables should be leaked
      expect(result).toEqual([])
    })

    it('should have a minimal environment footprint', async () => {
      const code = `
import os

def handler():
    return len(os.environ)
`
      const result = await invokePython(code, 'handler', [])
      // Should only have the whitelisted variables (PATH, HOME, PYTHONIOENCODING)
      // Plus system-essential ones that may be injected by macOS/Linux (up to ~10)
      // but definitely not the 10+ mock secrets we set in beforeEach
      expect(result).toBeLessThanOrEqual(15)
      // And definitely more than 0 (we need at least PATH)
      expect(result).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Dynamic Sensitive Variable Injection Prevention', () => {
    it('should not pass dynamically added secrets', async () => {
      // Simulate a scenario where secrets are added to process.env at runtime
      process.env.DYNAMIC_SECRET = 'dynamic-secret-value'

      const code = `
import os

def handler():
    return os.environ.get('DYNAMIC_SECRET', 'NOT_FOUND')
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toBe('NOT_FOUND')
    })

    it('should not pass variables with common secret naming patterns', async () => {
      // Add various common secret naming patterns
      process.env.MY_APP_SECRET = 'secret1'
      process.env.DB_PASSWORD = 'secret2'
      process.env.PRIVATE_KEY = 'secret3'
      process.env.ACCESS_TOKEN = 'secret4'
      process.env.REFRESH_TOKEN = 'secret5'

      const code = `
import os

def handler():
    secrets = {
        'MY_APP_SECRET': os.environ.get('MY_APP_SECRET', 'NOT_FOUND'),
        'DB_PASSWORD': os.environ.get('DB_PASSWORD', 'NOT_FOUND'),
        'PRIVATE_KEY': os.environ.get('PRIVATE_KEY', 'NOT_FOUND'),
        'ACCESS_TOKEN': os.environ.get('ACCESS_TOKEN', 'NOT_FOUND'),
        'REFRESH_TOKEN': os.environ.get('REFRESH_TOKEN', 'NOT_FOUND'),
    }
    return secrets
`
      const result = await invokePython(code, 'handler', [])
      expect(result).toEqual({
        MY_APP_SECRET: 'NOT_FOUND',
        DB_PASSWORD: 'NOT_FOUND',
        PRIVATE_KEY: 'NOT_FOUND',
        ACCESS_TOKEN: 'NOT_FOUND',
        REFRESH_TOKEN: 'NOT_FOUND',
      })
    })
  })

  describe('Real-World Attack Scenarios', () => {
    it('should prevent malicious code from exfiltrating secrets via environment', async () => {
      const code = `
import os

def handler():
    # Simulating malicious code trying to steal all secrets
    stolen_secrets = {}
    for key, value in os.environ.items():
        if any(pattern in key.upper() for pattern in ['SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'CREDENTIAL']):
            stolen_secrets[key] = value
    return stolen_secrets
`
      const result = await invokePython(code, 'handler', [])
      // Malicious code should not be able to steal any secrets
      expect(result).toEqual({})
    })

    it('should prevent environment variable dumping attacks', async () => {
      const code = `
import os
import json

def handler():
    # Attacker tries to dump entire environment
    return dict(os.environ)
`
      const result = await invokePython(code, 'handler', []) as Record<string, string>

      // The dumped environment should not contain any sensitive values
      expect(result['SECRET_KEY']).toBeUndefined()
      expect(result['DATABASE_URL']).toBeUndefined()
      expect(result['API_KEY']).toBeUndefined()
      expect(result['AWS_ACCESS_KEY_ID']).toBeUndefined()
      expect(result['AWS_SECRET_ACCESS_KEY']).toBeUndefined()
      expect(result['AUTH_TOKEN']).toBeUndefined()
      expect(result['STRIPE_SECRET_KEY']).toBeUndefined()
      expect(result['REDIS_URL']).toBeUndefined()
      expect(result['OPENAI_API_KEY']).toBeUndefined()
      expect(result['GITHUB_TOKEN']).toBeUndefined()
    })
  })
})
