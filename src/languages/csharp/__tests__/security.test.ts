/**
 * Roslyn Security and Sandboxing Tests (RED)
 *
 * These tests validate the security restrictions and sandboxing for
 * Roslyn script execution. Key features tested:
 * 1. API restriction through whitelists
 * 2. Dangerous pattern detection
 * 3. Timeout and memory limits
 * 4. Sandbox execution
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  analyzeCodeSecurity,
  createExecutionMonitor,
  createSandbox,
  executeInSandbox,
  destroySandbox,
  wrapWithSecurityContext,
  createSecureScriptOptions,
  isTypeAllowed,
  isMethodAllowed,
  detectDangerousPatterns,
  validateCode,
  getSecurityProfile,
  DEFAULT_SECURITY_POLICY,
  DEFAULT_RESOURCE_LIMITS,
  SECURITY_PROFILES,
  DANGEROUS_PATTERNS,
  type RoslynSecurityPolicy,
  type ResourceLimits,
  type SecurityViolation,
  type SecurityAnalysisResult,
  type ExecutionMonitor,
  type SandboxContext,
} from '../security'

describe('Security Policy', () => {
  describe('DEFAULT_SECURITY_POLICY', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_SECURITY_POLICY.allowUnsafe).toBe(false)
      expect(DEFAULT_SECURITY_POLICY.checkOverflow).toBe(true)
      expect(DEFAULT_SECURITY_POLICY.allowReflection).toBe(false)
      expect(DEFAULT_SECURITY_POLICY.allowFileSystem).toBe(false)
      expect(DEFAULT_SECURITY_POLICY.allowNetwork).toBe(false)
      expect(DEFAULT_SECURITY_POLICY.allowProcessControl).toBe(false)
    })

    it('includes safe assemblies', () => {
      expect(DEFAULT_SECURITY_POLICY.allowedAssemblies).toContain('System.Private.CoreLib')
      expect(DEFAULT_SECURITY_POLICY.allowedAssemblies).toContain('System.Linq')
      expect(DEFAULT_SECURITY_POLICY.allowedAssemblies).toContain('System.Text.Json')
    })

    it('blocks dangerous types', () => {
      expect(DEFAULT_SECURITY_POLICY.blockedTypes).toContain('System.IO.File')
      expect(DEFAULT_SECURITY_POLICY.blockedTypes).toContain('System.Net.Http.HttpClient')
      expect(DEFAULT_SECURITY_POLICY.blockedTypes).toContain('System.Diagnostics.Process')
      expect(DEFAULT_SECURITY_POLICY.blockedTypes).toContain('System.Reflection.Assembly')
    })

    it('blocks dangerous methods', () => {
      expect(DEFAULT_SECURITY_POLICY.blockedMethods).toContain('System.Type.GetType')
      expect(DEFAULT_SECURITY_POLICY.blockedMethods).toContain('System.Reflection.Assembly.Load')
      expect(DEFAULT_SECURITY_POLICY.blockedMethods).toContain('System.GC.Collect')
    })
  })

  describe('SECURITY_PROFILES', () => {
    it('has minimal profile', () => {
      const { policy, limits } = SECURITY_PROFILES.minimal
      expect(policy.allowedAssemblies.length).toBeLessThan(
        DEFAULT_SECURITY_POLICY.allowedAssemblies.length
      )
      expect(limits.timeoutMs).toBeLessThan(DEFAULT_RESOURCE_LIMITS.timeoutMs)
    })

    it('has standard profile', () => {
      const { policy, limits } = SECURITY_PROFILES.standard
      expect(policy).toEqual(DEFAULT_SECURITY_POLICY)
      expect(limits).toEqual(DEFAULT_RESOURCE_LIMITS)
    })

    it('has extended profile', () => {
      const { policy, limits } = SECURITY_PROFILES.extended
      expect(policy.allowedAssemblies.length).toBeGreaterThan(
        DEFAULT_SECURITY_POLICY.allowedAssemblies.length
      )
      expect(limits.timeoutMs).toBeGreaterThan(DEFAULT_RESOURCE_LIMITS.timeoutMs)
    })

    it('has trusted profile with network access', () => {
      const { policy } = SECURITY_PROFILES.trusted
      expect(policy.allowNetwork).toBe(true)
      expect(policy.allowReflection).toBe(true)
      // But still blocks process control
      expect(policy.blockedTypes).toContain('System.Diagnostics.Process')
    })
  })

  describe('getSecurityProfile', () => {
    it('returns profile by name', () => {
      const profile = getSecurityProfile('minimal')
      expect(profile.policy).toBeDefined()
      expect(profile.limits).toBeDefined()
    })
  })
})

describe('Resource Limits', () => {
  describe('DEFAULT_RESOURCE_LIMITS', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_RESOURCE_LIMITS.timeoutMs).toBe(30000)
      expect(DEFAULT_RESOURCE_LIMITS.maxMemoryBytes).toBe(128 * 1024 * 1024)
      expect(DEFAULT_RESOURCE_LIMITS.maxCpuTimeMs).toBe(10000)
      expect(DEFAULT_RESOURCE_LIMITS.maxRecursionDepth).toBe(100)
      expect(DEFAULT_RESOURCE_LIMITS.maxThreads).toBe(1)
    })
  })
})

describe('Type/Method Checking', () => {
  describe('isTypeAllowed', () => {
    it('allows types in allowed namespaces', () => {
      expect(isTypeAllowed('System.Int32', DEFAULT_SECURITY_POLICY)).toBe(true)
      expect(isTypeAllowed('System.String', DEFAULT_SECURITY_POLICY)).toBe(true)
      expect(isTypeAllowed('System.Collections.Generic.List', DEFAULT_SECURITY_POLICY)).toBe(true)
    })

    it('blocks explicitly blocked types', () => {
      expect(isTypeAllowed('System.IO.File', DEFAULT_SECURITY_POLICY)).toBe(false)
      expect(isTypeAllowed('System.Diagnostics.Process', DEFAULT_SECURITY_POLICY)).toBe(false)
    })

    it('blocks types in disallowed namespaces', () => {
      expect(isTypeAllowed('System.Net.Sockets.Socket', DEFAULT_SECURITY_POLICY)).toBe(false)
    })
  })

  describe('isMethodAllowed', () => {
    it('allows methods on allowed types', () => {
      expect(
        isMethodAllowed('System.String', 'Substring', DEFAULT_SECURITY_POLICY)
      ).toBe(true)
      expect(
        isMethodAllowed('System.Math', 'Sqrt', DEFAULT_SECURITY_POLICY)
      ).toBe(true)
    })

    it('blocks explicitly blocked methods', () => {
      expect(
        isMethodAllowed('System.Type', 'GetType', DEFAULT_SECURITY_POLICY)
      ).toBe(false)
      expect(
        isMethodAllowed('System.GC', 'Collect', DEFAULT_SECURITY_POLICY)
      ).toBe(false)
    })

    it('blocks methods on blocked types', () => {
      expect(
        isMethodAllowed('System.IO.File', 'ReadAllText', DEFAULT_SECURITY_POLICY)
      ).toBe(false)
    })
  })
})

describe('Dangerous Pattern Detection', () => {
  describe('detectDangerousPatterns', () => {
    it('detects file system access', () => {
      const code = `File.ReadAllText("secret.txt");`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('File system'))).toBe(true)
    })

    it('detects process spawning', () => {
      const code = `Process.Start("cmd.exe");`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('Process'))).toBe(true)
    })

    it('detects reflection abuse', () => {
      const code = `Assembly.Load("malicious.dll");`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('assembly loading'))).toBe(true)
    })

    it('detects unsafe code', () => {
      const code = `unsafe { int* ptr = &x; }`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('Unsafe'))).toBe(true)
    })

    it('detects HTTP client creation', () => {
      const code = `var client = new HttpClient();`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('HTTP'))).toBe(true)
    })

    it('detects thread creation', () => {
      const code = `new Thread(() => { }).Start();`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('Thread'))).toBe(true)
    })

    it('detects environment access', () => {
      const code = `Environment.GetEnvironmentVariable("SECRET");`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('Environment'))).toBe(true)
    })

    it('detects P/Invoke', () => {
      const code = `[DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string lpModuleName);`
      const patterns = detectDangerousPatterns(code)

      expect(patterns.some((p) => p.description.includes('P/Invoke'))).toBe(true)
    })

    it('counts multiple occurrences', () => {
      const code = `
        File.ReadAllText("a");
        File.ReadAllText("b");
        File.WriteAllText("c", "d");
      `
      const patterns = detectDangerousPatterns(code)
      const filePattern = patterns.find((p) => p.description.includes('File system'))

      expect(filePattern?.matches).toBe(3)
    })

    it('returns empty for safe code', () => {
      const code = `
        var x = 1 + 2;
        var list = new List<int> { 1, 2, 3 };
        var sum = list.Sum();
      `
      const patterns = detectDangerousPatterns(code)

      expect(patterns).toHaveLength(0)
    })
  })
})

describe('Code Validation', () => {
  describe('validateCode', () => {
    it('validates safe code', () => {
      const code = `
        var x = 1 + 2;
        return x * 3;
      `
      const result = validateCode(code)

      expect(result.valid).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('rejects code with dangerous patterns', () => {
      const code = `Process.Start("cmd");`
      const result = validateCode(code)

      expect(result.valid).toBe(false)
      expect(result.violations.some((v) => v.type === 'dangerous_pattern')).toBe(true)
    })

    it('rejects unsafe code when not allowed', () => {
      const code = `unsafe { int* p = null; }`
      const result = validateCode(code, { ...DEFAULT_SECURITY_POLICY, allowUnsafe: false })

      expect(result.valid).toBe(false)
      expect(result.violations.some((v) => v.type === 'unsafe_code')).toBe(true)
    })

    it('allows unsafe code when policy permits', () => {
      const code = `// no actual unsafe code`
      const result = validateCode(code, { ...DEFAULT_SECURITY_POLICY, allowUnsafe: true })

      expect(result.valid).toBe(true)
    })

    it('rejects reflection when not allowed', () => {
      const code = `typeof(MyClass).GetMethod("Secret");`
      const result = validateCode(code, { ...DEFAULT_SECURITY_POLICY, allowReflection: false })

      expect(result.valid).toBe(false)
      expect(result.violations.some((v) => v.type === 'reflection_usage')).toBe(true)
    })
  })
})

describe('Security Analysis', () => {
  describe('analyzeCodeSecurity', () => {
    it('analyzes safe code', () => {
      const code = `
        var numbers = new[] { 1, 2, 3, 4, 5 };
        return numbers.Where(n => n % 2 == 0).Sum();
      `
      const result = analyzeCodeSecurity(code)

      expect(result.safe).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('detects multiple violations', () => {
      const code = `
        var secret = Environment.GetEnvironmentVariable("API_KEY");
        var content = File.ReadAllText("/etc/passwd");
        Process.Start("rm", "-rf /");
      `
      const result = analyzeCodeSecurity(code)

      expect(result.safe).toBe(false)
      expect(result.violations.length).toBeGreaterThanOrEqual(3)
    })

    it('includes violation locations', () => {
      const code = `File.ReadAllText("test");`
      const result = analyzeCodeSecurity(code)

      const violation = result.violations[0]
      expect(violation?.location).toBeDefined()
      expect(violation?.location?.line).toBeGreaterThanOrEqual(0)
      expect(violation?.location?.column).toBeGreaterThanOrEqual(0)
    })

    it('detects APIs used', () => {
      const code = `
        var json = JsonSerializer.Serialize(obj);
        var regex = new Regex(@"\d+");
      `
      const result = analyzeCodeSecurity(code)

      expect(result.detectedApis).toContain('JsonSerializer.Serialize')
    })

    it('reports analysis time', () => {
      const code = `return 42;`
      const result = analyzeCodeSecurity(code)

      expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('uses custom policy when provided', () => {
      const code = `var client = new HttpClient();`
      const restrictive: RoslynSecurityPolicy = {
        ...DEFAULT_SECURITY_POLICY,
        blockedTypes: [...DEFAULT_SECURITY_POLICY.blockedTypes, 'System.Net.Http.HttpClient'],
      }

      const result = analyzeCodeSecurity(code, restrictive)
      expect(result.safe).toBe(false)
    })
  })
})

describe('Execution Monitor', () => {
  let monitor: ExecutionMonitor

  beforeEach(() => {
    monitor = createExecutionMonitor({
      timeoutMs: 1000,
      maxMemoryBytes: 10 * 1024 * 1024,
      maxCpuTimeMs: 500,
      maxInstructions: 1000000,
      maxStringLength: 100000,
      maxArrayLength: 100000,
      maxRecursionDepth: 50,
      maxThreads: 1,
    })
  })

  describe('start/stop', () => {
    it('starts monitoring', () => {
      expect(() => monitor.start()).not.toThrow()
    })

    it('stops monitoring', () => {
      monitor.start()
      expect(() => monitor.stop()).not.toThrow()
    })
  })

  describe('checkLimits', () => {
    it('returns null when within limits', () => {
      monitor.start()
      const violation = monitor.checkLimits()
      expect(violation).toBeNull()
      monitor.stop()
    })

    it('returns violation when timeout exceeded', async () => {
      monitor.start()
      await new Promise((r) => setTimeout(r, 1100)) // Wait longer than timeout
      const violation = monitor.checkLimits()
      expect(violation).not.toBeNull()
      expect(violation?.type).toBe('timeout')
      monitor.stop()
    })
  })

  describe('getUsage', () => {
    it('returns current resource usage', () => {
      monitor.start()
      const usage = monitor.getUsage()

      expect(usage.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(usage.memoryBytes).toBeGreaterThanOrEqual(0)
      expect(usage.cpuTimeMs).toBeGreaterThanOrEqual(0)

      monitor.stop()
    })
  })

  describe('cancel', () => {
    it('cancels execution', () => {
      monitor.start()
      expect(monitor.isCancelled()).toBe(false)
      monitor.cancel()
      expect(monitor.isCancelled()).toBe(true)
      monitor.stop()
    })
  })
})

describe('Sandbox', () => {
  let sandbox: SandboxContext

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    destroySandbox(sandbox)
  })

  describe('createSandbox', () => {
    it('creates sandbox with default policy', () => {
      const s = createSandbox()
      expect(s).toBeDefined()
      expect(s.id).toBeDefined()
      expect(s.policy).toBeDefined()
      expect(s.limits).toBeDefined()
      destroySandbox(s)
    })

    it('creates sandbox with custom policy', () => {
      const customPolicy: RoslynSecurityPolicy = {
        ...DEFAULT_SECURITY_POLICY,
        allowReflection: true,
      }
      const s = createSandbox(customPolicy)
      expect(s.policy.allowReflection).toBe(true)
      destroySandbox(s)
    })

    it('creates sandbox with custom limits', () => {
      const customLimits: ResourceLimits = {
        ...DEFAULT_RESOURCE_LIMITS,
        timeoutMs: 5000,
      }
      const s = createSandbox(undefined, customLimits)
      expect(s.limits.timeoutMs).toBe(5000)
      destroySandbox(s)
    })
  })

  describe('executeInSandbox', () => {
    it('executes safe code', async () => {
      const code = `return 1 + 2;`
      const result = await executeInSandbox<number>(code, sandbox)

      expect(result.result).toBe(3)
    })

    it('returns resource usage', async () => {
      const code = `return "hello";`
      const { usage } = await executeInSandbox<string>(code, sandbox)

      expect(usage.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(usage.memoryBytes).toBeGreaterThanOrEqual(0)
    })

    it('enforces timeout', async () => {
      const shortTimeout = createSandbox(undefined, {
        ...DEFAULT_RESOURCE_LIMITS,
        timeoutMs: 100,
      })

      const code = `while(true) { }`

      await expect(executeInSandbox(code, shortTimeout)).rejects.toThrow()
      destroySandbox(shortTimeout)
    })

    it('passes globals to script', async () => {
      const code = `return (int)x * 2;`
      const globals = { x: 21 }
      const result = await executeInSandbox<number>(code, sandbox, globals)

      expect(result.result).toBe(42)
    })

    it('rejects dangerous code', async () => {
      const code = `File.ReadAllText("/etc/passwd");`

      await expect(executeInSandbox(code, sandbox)).rejects.toThrow()
    })
  })

  describe('destroySandbox', () => {
    it('marks sandbox as inactive', () => {
      expect(sandbox.active).toBe(true)
      destroySandbox(sandbox)
      expect(sandbox.active).toBe(false)
    })
  })
})

describe('Security Context Wrapping', () => {
  describe('wrapWithSecurityContext', () => {
    it('wraps code with security checks', () => {
      const code = `return x + y;`
      const wrapped = wrapWithSecurityContext(code, DEFAULT_SECURITY_POLICY)

      expect(wrapped).toContain(code)
      expect(wrapped.length).toBeGreaterThan(code.length)
    })
  })

  describe('createSecureScriptOptions', () => {
    it('creates script options from policy', () => {
      const options = createSecureScriptOptions(DEFAULT_SECURITY_POLICY)
      expect(options).toBeDefined()
    })
  })
})
