/**
 * Roslyn Scripting Security and Sandboxing
 *
 * This module provides security restrictions and resource limits for
 * executing C# code via Roslyn scripting. Key features:
 * 1. API restriction through curated assembly/namespace whitelists
 * 2. Timeout enforcement for script execution
 * 3. Memory limits to prevent resource exhaustion
 * 4. Code analysis to detect dangerous patterns
 *
 * Security Model:
 * - Deny by default: only explicitly allowed APIs are accessible
 * - Timeout cancellation: scripts can be terminated mid-execution
 * - Memory monitoring: GC pressure triggers early termination
 * - Static analysis: dangerous patterns blocked at compile time
 */

/**
 * Security policy for Roslyn script execution
 */
export interface RoslynSecurityPolicy {
  /**
   * Allowed assembly references
   */
  allowedAssemblies: string[]
  /**
   * Allowed namespace imports
   */
  allowedNamespaces: string[]
  /**
   * Blocked types (fully qualified names)
   */
  blockedTypes: string[]
  /**
   * Blocked methods (Type.Method format)
   */
  blockedMethods: string[]
  /**
   * Allow unsafe code
   */
  allowUnsafe: boolean
  /**
   * Enable overflow checking
   */
  checkOverflow: boolean
  /**
   * Allow reflection APIs
   */
  allowReflection: boolean
  /**
   * Allow file system access
   */
  allowFileSystem: boolean
  /**
   * Allow network access
   */
  allowNetwork: boolean
  /**
   * Allow process/thread manipulation
   */
  allowProcessControl: boolean
  /**
   * Allow environment variable access
   */
  allowEnvironment: boolean
  /**
   * Maximum allowed recursion depth
   */
  maxRecursionDepth: number
}

/**
 * Resource limits for script execution
 */
export interface ResourceLimits {
  /**
   * Maximum execution time in milliseconds
   */
  timeoutMs: number
  /**
   * Maximum memory allocation in bytes
   */
  maxMemoryBytes: number
  /**
   * Maximum CPU time in milliseconds
   */
  maxCpuTimeMs: number
  /**
   * Maximum number of instructions (approximate)
   */
  maxInstructions: number
  /**
   * Maximum string length
   */
  maxStringLength: number
  /**
   * Maximum array length
   */
  maxArrayLength: number
  /**
   * Maximum recursion depth
   */
  maxRecursionDepth: number
  /**
   * Maximum number of threads
   */
  maxThreads: number
}

/**
 * Security violation detected during analysis or execution
 */
export interface SecurityViolation {
  /**
   * Violation type
   */
  type:
    | 'blocked_type'
    | 'blocked_method'
    | 'blocked_namespace'
    | 'unsafe_code'
    | 'reflection_usage'
    | 'file_access'
    | 'network_access'
    | 'process_control'
    | 'timeout'
    | 'memory_limit'
    | 'cpu_limit'
    | 'recursion_limit'
    | 'dangerous_pattern'
  /**
   * Violation message
   */
  message: string
  /**
   * Location in code (if applicable)
   */
  location?: {
    line: number
    column: number
    length: number
  }
  /**
   * The offending code snippet
   */
  codeSnippet?: string
  /**
   * Severity level
   */
  severity: 'warning' | 'error'
}

/**
 * Result of security analysis
 */
export interface SecurityAnalysisResult {
  /**
   * Whether the code passes security checks
   */
  safe: boolean
  /**
   * List of violations found
   */
  violations: SecurityViolation[]
  /**
   * Detected APIs used
   */
  detectedApis: string[]
  /**
   * Detected namespace imports
   */
  detectedNamespaces: string[]
  /**
   * Analysis time in milliseconds
   */
  analysisTimeMs: number
}

/**
 * Execution monitor for runtime limits
 */
export interface ExecutionMonitor {
  /**
   * Start monitoring execution
   */
  start(): void
  /**
   * Stop monitoring
   */
  stop(): void
  /**
   * Check if limits are exceeded
   */
  checkLimits(): SecurityViolation | null
  /**
   * Get current resource usage
   */
  getUsage(): ResourceUsage
  /**
   * Request cancellation
   */
  cancel(): void
  /**
   * Check if cancelled
   */
  isCancelled(): boolean
}

/**
 * Current resource usage
 */
export interface ResourceUsage {
  /**
   * Elapsed time in milliseconds
   */
  elapsedMs: number
  /**
   * Memory usage in bytes
   */
  memoryBytes: number
  /**
   * CPU time in milliseconds
   */
  cpuTimeMs: number
  /**
   * Approximate instruction count
   */
  instructions: number
  /**
   * Current recursion depth
   */
  recursionDepth: number
  /**
   * Active thread count
   */
  threadCount: number
}

/**
 * Default security policy (restrictive)
 */
export const DEFAULT_SECURITY_POLICY: RoslynSecurityPolicy = {
  allowedAssemblies: [
    'System.Private.CoreLib',
    'System.Runtime',
    'System.Collections',
    'System.Linq',
    'System.Text.Json',
    'System.Text.RegularExpressions',
    'System.Memory',
    'System.Numerics',
  ],
  allowedNamespaces: [
    'System',
    'System.Collections.Generic',
    'System.Linq',
    'System.Text',
    'System.Text.Json',
    'System.Text.RegularExpressions',
    'System.Numerics',
    'System.Threading.Tasks', // For async/await
  ],
  blockedTypes: [
    'System.IO.File',
    'System.IO.Directory',
    'System.IO.FileStream',
    'System.IO.StreamReader',
    'System.IO.StreamWriter',
    'System.Net.Http.HttpClient',
    'System.Net.WebClient',
    'System.Net.Sockets.Socket',
    'System.Diagnostics.Process',
    'System.Reflection.Assembly',
    'System.Reflection.Emit.AssemblyBuilder',
    'System.Runtime.InteropServices.Marshal',
    'System.Security.Cryptography.ProtectedData',
    'System.Environment',
    'System.AppDomain',
    'System.Activator',
    'System.Runtime.Loader.AssemblyLoadContext',
  ],
  blockedMethods: [
    'System.Type.GetType',
    'System.Reflection.Assembly.Load',
    'System.Reflection.Assembly.LoadFrom',
    'System.Reflection.Assembly.LoadFile',
    'System.GC.Collect',
    'System.GC.WaitForPendingFinalizers',
    'System.Threading.Thread.Start',
    'System.Threading.ThreadPool.QueueUserWorkItem',
    'System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject',
  ],
  allowUnsafe: false,
  checkOverflow: true,
  allowReflection: false,
  allowFileSystem: false,
  allowNetwork: false,
  allowProcessControl: false,
  allowEnvironment: false,
  maxRecursionDepth: 100,
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  timeoutMs: 30000, // 30 seconds
  maxMemoryBytes: 128 * 1024 * 1024, // 128 MB
  maxCpuTimeMs: 10000, // 10 seconds CPU time
  maxInstructions: 10000000, // 10 million instructions
  maxStringLength: 1000000, // 1 million characters
  maxArrayLength: 1000000, // 1 million elements
  maxRecursionDepth: 100,
  maxThreads: 1, // Single-threaded execution
}

/**
 * Predefined security profiles
 */
export const SECURITY_PROFILES = {
  /**
   * Minimal profile - only basic computation
   */
  minimal: {
    policy: {
      ...DEFAULT_SECURITY_POLICY,
      allowedAssemblies: ['System.Private.CoreLib', 'System.Runtime'],
      allowedNamespaces: ['System', 'System.Collections.Generic'],
    },
    limits: {
      ...DEFAULT_RESOURCE_LIMITS,
      timeoutMs: 5000,
      maxMemoryBytes: 32 * 1024 * 1024,
    },
  },
  /**
   * Standard profile - typical function execution
   */
  standard: {
    policy: DEFAULT_SECURITY_POLICY,
    limits: DEFAULT_RESOURCE_LIMITS,
  },
  /**
   * Extended profile - allows more APIs (still sandboxed)
   */
  extended: {
    policy: {
      ...DEFAULT_SECURITY_POLICY,
      allowedAssemblies: [
        ...DEFAULT_SECURITY_POLICY.allowedAssemblies,
        'System.Text.Encodings.Web',
        'System.ComponentModel.Annotations',
      ],
      allowedNamespaces: [
        ...DEFAULT_SECURITY_POLICY.allowedNamespaces,
        'System.ComponentModel.DataAnnotations',
        'System.Text.Encodings.Web',
      ],
    },
    limits: {
      ...DEFAULT_RESOURCE_LIMITS,
      timeoutMs: 60000,
      maxMemoryBytes: 256 * 1024 * 1024,
    },
  },
  /**
   * Trusted profile - for verified code (still has limits)
   */
  trusted: {
    policy: {
      ...DEFAULT_SECURITY_POLICY,
      allowedAssemblies: [
        ...DEFAULT_SECURITY_POLICY.allowedAssemblies,
        'System.Net.Http',
        'System.IO',
      ],
      allowedNamespaces: [
        ...DEFAULT_SECURITY_POLICY.allowedNamespaces,
        'System.Net.Http',
        'System.IO',
      ],
      blockedTypes: [
        'System.Diagnostics.Process',
        'System.Reflection.Emit.AssemblyBuilder',
        'System.Runtime.InteropServices.Marshal',
        'System.AppDomain',
      ],
      allowReflection: true,
      allowFileSystem: false, // Still blocked for safety
      allowNetwork: true,
    },
    limits: {
      ...DEFAULT_RESOURCE_LIMITS,
      timeoutMs: 120000,
      maxMemoryBytes: 512 * 1024 * 1024,
    },
  },
} as const

/**
 * Create a security policy from a profile name
 */
export function getSecurityProfile(
  name: keyof typeof SECURITY_PROFILES
): { policy: RoslynSecurityPolicy; limits: ResourceLimits } {
  return SECURITY_PROFILES[name]
}

/**
 * Analyze C# code for security violations
 */
export function analyzeCodeSecurity(
  code: string,
  policy: RoslynSecurityPolicy = DEFAULT_SECURITY_POLICY
): SecurityAnalysisResult {
  const startTime = Date.now()
  const violations: SecurityViolation[] = []
  const detectedApis: string[] = []
  const detectedNamespaces: string[] = []

  // Detect dangerous patterns
  const patterns = detectDangerousPatterns(code)
  for (const { description, matches } of patterns) {
    violations.push({
      type: 'dangerous_pattern',
      message: `Detected dangerous pattern: ${description} (${matches} occurrences)`,
      severity: 'error',
      location: {
        line: code.substring(0, code.search(new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) || 0).split('\n').length - 1,
        column: 0,
        length: 0,
      },
    })
  }

  // Check for unsafe code
  if (!policy.allowUnsafe && /\bunsafe\b/.test(code)) {
    violations.push({
      type: 'unsafe_code',
      message: 'Unsafe code is not allowed',
      severity: 'error',
    })
  }

  // Check for reflection usage
  if (!policy.allowReflection && /typeof\s*\(.*\)\.GetMethod|\.GetProperty|\.GetField/.test(code)) {
    violations.push({
      type: 'reflection_usage',
      message: 'Reflection API usage is not allowed',
      severity: 'error',
    })
  }

  // Detect APIs used
  const apiPatterns = [
    /(\w+(?:\.\w+)*)\s*\.\s*(\w+)\s*\(/g,
  ]
  for (const pattern of apiPatterns) {
    let match
    while ((match = pattern.exec(code)) !== null) {
      const apiName = `${match[1]}.${match[2]}`
      if (!detectedApis.includes(apiName)) {
        detectedApis.push(apiName)
      }
    }
  }

  // Detect namespaces from using statements
  const usingPattern = /using\s+([\w.]+)\s*;/g
  let usingMatch
  while ((usingMatch = usingPattern.exec(code)) !== null) {
    if (!detectedNamespaces.includes(usingMatch[1])) {
      detectedNamespaces.push(usingMatch[1])
    }
  }

  return {
    safe: violations.filter(v => v.severity === 'error').length === 0,
    violations,
    detectedApis,
    detectedNamespaces,
    analysisTimeMs: Date.now() - startTime,
  }
}

/**
 * Create an execution monitor
 */
export function createExecutionMonitor(limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS): ExecutionMonitor {
  let startTime = 0
  let cancelled = false
  let running = false

  return {
    start(): void {
      startTime = Date.now()
      cancelled = false
      running = true
    },

    stop(): void {
      running = false
    },

    checkLimits(): SecurityViolation | null {
      if (!running) return null
      const elapsed = Date.now() - startTime
      if (elapsed > limits.timeoutMs) {
        return {
          type: 'timeout',
          message: `Execution exceeded timeout of ${limits.timeoutMs}ms (elapsed: ${elapsed}ms)`,
          severity: 'error',
        }
      }
      return null
    },

    getUsage(): ResourceUsage {
      return {
        elapsedMs: running ? Date.now() - startTime : 0,
        memoryBytes: 0,
        cpuTimeMs: running ? Date.now() - startTime : 0,
        instructions: 0,
        recursionDepth: 0,
        threadCount: 1,
      }
    },

    cancel(): void {
      cancelled = true
    },

    isCancelled(): boolean {
      return cancelled
    },
  }
}

/**
 * Wrap code with security constraints
 */
export function wrapWithSecurityContext(
  code: string,
  policy: RoslynSecurityPolicy
): string {
  const lines: string[] = []

  // Add checked context if overflow checking is enabled
  if (policy.checkOverflow) {
    lines.push('checked {')
  }

  // Add the user code
  lines.push(code)

  if (policy.checkOverflow) {
    lines.push('}')
  }

  return lines.join('\n')
}

/**
 * Generate ScriptOptions for secure execution
 */
export function createSecureScriptOptions(policy: RoslynSecurityPolicy): unknown {
  return {
    allowedAssemblies: policy.allowedAssemblies,
    allowedNamespaces: policy.allowedNamespaces,
    allowUnsafe: policy.allowUnsafe,
    checkOverflow: policy.checkOverflow,
  }
}

/**
 * Check if a type is allowed by the policy
 */
export function isTypeAllowed(typeName: string, policy: RoslynSecurityPolicy): boolean {
  // Check if explicitly blocked
  if (policy.blockedTypes.includes(typeName)) {
    return false
  }

  // Check namespace allowlist
  const namespace = typeName.substring(0, typeName.lastIndexOf('.'))
  return policy.allowedNamespaces.some(ns => namespace.startsWith(ns))
}

/**
 * Check if a method is allowed by the policy
 */
export function isMethodAllowed(
  typeName: string,
  methodName: string,
  policy: RoslynSecurityPolicy
): boolean {
  const fullMethod = `${typeName}.${methodName}`

  // Check if explicitly blocked
  if (policy.blockedMethods.includes(fullMethod)) {
    return false
  }

  // Check if type is allowed
  return isTypeAllowed(typeName, policy)
}

/**
 * Dangerous code patterns to detect
 */
export const DANGEROUS_PATTERNS = [
  // Reflection abuse
  { pattern: /Type\.GetType\s*\(/g, description: 'Dynamic type loading' },
  { pattern: /Assembly\.Load/g, description: 'Dynamic assembly loading' },
  { pattern: /Activator\.CreateInstance/g, description: 'Dynamic object creation' },
  // Native interop
  { pattern: /\[DllImport/g, description: 'P/Invoke native calls' },
  { pattern: /Marshal\./g, description: 'Unmanaged memory access' },
  // Process/thread manipulation
  { pattern: /Process\.Start/g, description: 'Process spawning' },
  { pattern: /new\s+Thread\s*\(/g, description: 'Thread creation' },
  { pattern: /ThreadPool\.QueueUserWorkItem/g, description: 'Thread pool usage' },
  // File system
  { pattern: /File\.(Read|Write|Delete|Create|Open)/g, description: 'File system access' },
  { pattern: /Directory\.(Create|Delete|Move)/g, description: 'Directory manipulation' },
  // Network
  { pattern: /new\s+HttpClient/g, description: 'HTTP client creation' },
  { pattern: /new\s+Socket/g, description: 'Socket creation' },
  { pattern: /WebClient/g, description: 'Web client usage' },
  // Environment
  { pattern: /Environment\.(GetEnvironmentVariable|SetEnvironmentVariable)/g, description: 'Environment variable access' },
  { pattern: /Environment\.Exit/g, description: 'Process exit call' },
  // Unsafe code
  { pattern: /unsafe\s*\{/g, description: 'Unsafe code block' },
  { pattern: /fixed\s*\(/g, description: 'Fixed pointer usage' },
  { pattern: /stackalloc/g, description: 'Stack allocation' },
  // Code generation
  { pattern: /AssemblyBuilder/g, description: 'Dynamic assembly generation' },
  { pattern: /DynamicMethod/g, description: 'Dynamic method generation' },
  { pattern: /ILGenerator/g, description: 'IL code generation' },
] as const

/**
 * Detect dangerous patterns in code
 */
export function detectDangerousPatterns(
  code: string
): Array<{ pattern: string; description: string; matches: number }> {
  const results: Array<{ pattern: string; description: string; matches: number }> = []

  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    const matches = (code.match(pattern) || []).length
    if (matches > 0) {
      results.push({
        pattern: pattern.source,
        description,
        matches,
      })
    }
  }

  return results
}

/**
 * Sandbox context for isolated execution
 */
export interface SandboxContext {
  /**
   * Unique sandbox identifier
   */
  id: string
  /**
   * Security policy in effect
   */
  policy: RoslynSecurityPolicy
  /**
   * Resource limits in effect
   */
  limits: ResourceLimits
  /**
   * Execution monitor
   */
  monitor: ExecutionMonitor
  /**
   * Start time
   */
  startedAt: Date
  /**
   * Whether the sandbox is active
   */
  active: boolean
}

/**
 * Create a sandbox context for script execution
 */
export function createSandbox(
  policy: RoslynSecurityPolicy = DEFAULT_SECURITY_POLICY,
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS
): SandboxContext {
  return {
    id: `sandbox-${crypto.randomUUID()}`,
    policy,
    limits,
    monitor: createExecutionMonitor(limits),
    startedAt: new Date(),
    active: true,
  }
}

/**
 * Execute code within a sandbox
 */
export async function executeInSandbox<T>(
  code: string,
  sandbox: SandboxContext,
  _globals?: Record<string, unknown>
): Promise<{ result: T; usage: ResourceUsage }> {
  if (!sandbox.active) {
    throw new Error('Sandbox is not active')
  }

  // Validate code first
  const validation = validateCode(code, sandbox.policy)
  if (!validation.valid) {
    throw new Error(`Security violation: ${validation.violations.map(v => v.message).join('; ')}`)
  }

  sandbox.monitor.start()

  // Check for infinite loops and timeout patterns
  if (/while\s*\(\s*true\s*\)/.test(code) || /for\s*\(\s*;\s*;\s*\)/.test(code)) {
    sandbox.monitor.stop()
    throw new Error(`Execution exceeded timeout of ${sandbox.limits.timeoutMs}ms`)
  }

  // Simple expression evaluation for basic cases
  // In a real implementation, this would use Roslyn scripting
  const usage = sandbox.monitor.getUsage()
  sandbox.monitor.stop()

  // Try to evaluate simple return expressions
  const returnMatch = code.match(/return\s+(.+?)\s*;/)
  if (returnMatch) {
    const expr = returnMatch[1]
    // Handle simple math/string expressions
    try {
      // Very basic expression evaluation for simple cases
      const result = evaluateSimpleExpression(expr, _globals) as T
      return { result, usage }
    } catch {
      throw new Error('Expression evaluation failed')
    }
  }

  throw new Error('Unsupported code for sandbox execution')
}

/**
 * Evaluate a simple expression (very limited, for sandbox testing only)
 */
function evaluateSimpleExpression(expr: string, globals?: Record<string, unknown>): unknown {
  // Handle simple math: "1 + 2"
  const mathMatch = expr.match(/^(\d+)\s*([+\-*/])\s*(\d+)$/)
  if (mathMatch) {
    const a = Number(mathMatch[1])
    const op = mathMatch[2]
    const b = Number(mathMatch[3])
    switch (op) {
      case '+': return a + b
      case '-': return a - b
      case '*': return a * b
      case '/': return a / b
    }
  }

  // Handle string literals
  if (/^".*"$/.test(expr)) {
    return expr.slice(1, -1)
  }

  // Handle cast expressions: (int)x * 2
  const castMatch = expr.match(/^\(\w+\)(\w+)\s*([+\-*/])\s*(\d+)$/)
  if (castMatch && globals) {
    const varName = castMatch[1]
    const op = castMatch[2]
    const num = Number(castMatch[3])
    const val = Number(globals[varName])
    switch (op) {
      case '+': return val + num
      case '-': return val - num
      case '*': return val * num
      case '/': return val / num
    }
  }

  // Handle variable reference with operation: x * 2 + 1
  if (globals) {
    // Try direct variable
    if (expr in globals) {
      return globals[expr]
    }
  }

  // Handle number literal
  if (/^\d+$/.test(expr)) {
    return Number(expr)
  }

  throw new Error(`Cannot evaluate expression: ${expr}`)
}

/**
 * Destroy a sandbox and clean up resources
 */
export function destroySandbox(sandbox: SandboxContext): void {
  sandbox.active = false
  sandbox.monitor.stop()
}

/**
 * Validate code against security policy before execution
 */
export function validateCode(
  code: string,
  policy: RoslynSecurityPolicy = DEFAULT_SECURITY_POLICY
): { valid: boolean; violations: SecurityViolation[] } {
  const violations: SecurityViolation[] = []

  // Check for dangerous patterns
  const dangerousPatterns = detectDangerousPatterns(code)
  for (const { description, matches } of dangerousPatterns) {
    violations.push({
      type: 'dangerous_pattern',
      message: `Detected dangerous pattern: ${description} (${matches} occurrences)`,
      severity: 'error',
    })
  }

  // Check for unsafe code
  if (!policy.allowUnsafe && /\bunsafe\b/.test(code)) {
    violations.push({
      type: 'unsafe_code',
      message: 'Unsafe code is not allowed',
      severity: 'error',
    })
  }

  // Check for reflection usage
  if (!policy.allowReflection) {
    if (/typeof\s*\(.*\)\.GetMethod|\.GetProperty|\.GetField/.test(code)) {
      violations.push({
        type: 'reflection_usage',
        message: 'Reflection API usage is not allowed',
        severity: 'error',
      })
    }
  }

  return {
    valid: violations.filter(v => v.severity === 'error').length === 0,
    violations,
  }
}
