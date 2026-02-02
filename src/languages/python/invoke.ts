/**
 * Python Invoker for Functions.do
 *
 * This module provides the invokePython function for executing Python code
 * with a specified handler function and arguments.
 *
 * For local testing, it uses a Python subprocess.
 * In Cloudflare Workers, this would use Pyodide.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * Whitelist of environment variables that are safe to pass to Python subprocesses.
 * Only these essential variables are exposed to prevent leaking secrets.
 */
const SAFE_ENV_VARS = ['PATH', 'HOME']

/**
 * Default timeout for Python subprocess execution in milliseconds.
 * This prevents hanging processes from blocking indefinitely.
 */
export const DEFAULT_PYTHON_TIMEOUT_MS = 30_000

/**
 * Options for Python invocation
 */
export interface InvokePythonOptions {
  /**
   * Timeout in milliseconds for the Python subprocess.
   * If the subprocess doesn't complete within this time, it will be killed.
   * Defaults to 30 seconds.
   */
  timeoutMs?: number
}

/**
 * Custom error class for Python subprocess timeout
 */
export class PythonTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Python subprocess timed out after ${timeoutMs}ms`)
    this.name = 'PythonTimeoutError'
  }
}

/**
 * Validates that a string is a valid Python identifier.
 * Python identifiers must start with a letter or underscore,
 * followed by letters, digits, or underscores.
 *
 * @param name - The string to validate
 * @returns true if the name is a valid Python identifier, false otherwise
 */
export function isValidPythonIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

/**
 * Invokes a Python function with the specified handler and arguments.
 *
 * @param code - The Python source code containing the handler function
 * @param handlerName - The name of the function to invoke
 * @param args - Array of arguments to pass to the handler function
 * @param options - Optional configuration including timeout
 * @returns Promise resolving to the result of the Python function
 * @throws Error if the Python code has syntax errors, runtime errors, or the handler is not found
 * @throws PythonTimeoutError if the subprocess times out
 */
export async function invokePython(
  code: string,
  handlerName: string,
  args: unknown[],
  options: InvokePythonOptions = {}
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PYTHON_TIMEOUT_MS

  // Build the Python wrapper script that:
  // 1. Executes the user code to define functions
  // 2. Calls the specified handler with arguments
  // 3. Returns the result as JSON
  const wrappedCode = buildPythonWrapper(code, handlerName, args)

  return new Promise((resolve, reject) => {
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Build a safe environment with only whitelisted variables
    const safeEnv: Record<string, string> = {
      PYTHONIOENCODING: 'utf-8',
    }
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key]) {
        safeEnv[key] = process.env[key]
      }
    }

    const python = spawn('python3', ['-c', wrappedCode], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: safeEnv,
    })

    // Set up timeout to kill the process if it takes too long
    timeoutId = setTimeout(() => {
      timedOut = true
      killProcess(python)
      reject(new PythonTimeoutError(timeoutMs))
    }, timeoutMs)

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (exitCode) => {
      // Clear the timeout since the process has completed
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // If we already timed out, don't process the result
      if (timedOut) {
        return
      }

      if (exitCode !== 0) {
        // Parse the error from stderr
        const error = parsePythonError(stderr)
        reject(error)
        return
      }

      try {
        // Parse the JSON result from stdout
        const result = parseResult(stdout.trim())
        resolve(result)
      } catch (parseError) {
        reject(new Error(`Failed to parse Python output: ${stdout}`))
      }
    })

    python.on('error', (err) => {
      // Clear the timeout since we're handling an error
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      reject(new Error(`Failed to spawn Python process: ${err.message}`))
    })
  })
}

/**
 * Kills a Python subprocess and its children.
 * Uses SIGKILL for immediate termination since the process is unresponsive.
 */
function killProcess(process: ChildProcessWithoutNullStreams): void {
  try {
    // First try SIGTERM for graceful shutdown
    process.kill('SIGTERM')
    // If process doesn't exit quickly, force kill
    setTimeout(() => {
      try {
        process.kill('SIGKILL')
      } catch {
        // Process may have already exited
      }
    }, 100)
  } catch {
    // Process may have already exited
  }
}

/**
 * Builds the Python wrapper script that executes user code and returns JSON result.
 */
function buildPythonWrapper(code: string, handlerName: string, args: unknown[]): string {
  // Validate handler name to prevent code injection
  if (!isValidPythonIdentifier(handlerName)) {
    throw new Error(`Invalid handler name: ${handlerName}. Must be a valid Python identifier.`)
  }

  // Serialize arguments to JSON for passing to Python
  const argsJson = JSON.stringify(args)

  // The wrapper script:
  // 1. Imports json for serialization
  // 2. Defines a helper to convert Python objects to JSON-serializable form
  // 3. Executes the user code
  // 4. Calls the handler with unpacked arguments
  // 5. Prints the result as JSON
  return `
import json
import sys

# Helper to convert Python objects to JSON-serializable form
def _to_json_serializable(obj):
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (int, float)):
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_to_json_serializable(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): _to_json_serializable(v) for k, v in obj.items()}
    # For other types, convert to string
    return str(obj)

# Execute user code
try:
    exec('''${escapeForPython(code)}''')
except SyntaxError as e:
    print(f"SyntaxError: {e}", file=sys.stderr)
    sys.exit(1)

# Check if handler exists
if '${handlerName}' not in dir():
    print(f"NameError: name '${handlerName}' is not defined", file=sys.stderr)
    sys.exit(1)

# Get the handler function
handler = globals()['${handlerName}']

# Parse arguments
args = json.loads('''${escapeForPython(argsJson)}''')

# Call handler with arguments
try:
    result = handler(*args)
    # Convert result to JSON-serializable form and print
    serializable = _to_json_serializable(result)
    print(json.dumps(serializable))
except Exception as e:
    error_type = type(e).__name__
    print(f"{error_type}: {e}", file=sys.stderr)
    sys.exit(1)
`
}

/**
 * Escapes a string for use in Python triple-quoted strings.
 *
 * Order matters: backslashes must be escaped first, otherwise the escaping
 * of quotes would be double-escaped.
 */
function escapeForPython(str: string): string {
  return str
    .replace(/\\/g, '\\\\')           // Escape backslashes first
    .replace(/'''/g, "\\'\\'\\'" )    // Escape triple single quotes
    .replace(/"""/g, '\\"\\"\\"')     // Escape triple double quotes
}

/**
 * Parses the Python error output and creates an appropriate Error.
 */
function parsePythonError(stderr: string): Error {
  const trimmed = stderr.trim()

  // Extract error message - look for common Python error patterns
  const errorMatch = trimmed.match(/^(\w+Error):\s*(.+)$/m)
  if (errorMatch) {
    const [, errorType, message] = errorMatch
    return new Error(`${message}`)
  }

  // Check for syntax error
  if (trimmed.includes('SyntaxError')) {
    return new Error(trimmed)
  }

  // Check for name error (undefined variable)
  if (trimmed.includes('NameError')) {
    return new Error(trimmed)
  }

  // Generic error
  return new Error(trimmed || 'Unknown Python error')
}

/**
 * Parses the JSON output from Python, handling special cases.
 */
function parseResult(output: string): unknown {
  if (output === '' || output === 'null') {
    return null
  }

  try {
    return JSON.parse(output)
  } catch {
    // If it's not valid JSON, return as string
    return output
  }
}
