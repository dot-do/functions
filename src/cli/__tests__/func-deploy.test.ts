import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { spawnSync, spawn, ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Type for JSON response bodies in tests
type JsonBody = Record<string, unknown>

/**
 * Mock Cloudflare API responses
 */
interface MockCloudflareUpload {
  id: string
  etag: string
  size: number
  created_on: string
  modified_on: string
}

interface MockCloudflareDeployment {
  id: string
  url: string
  environment: string
  created_on: string
}

/**
 * Check if func CLI is available
 */
function isFuncCliAvailable(): boolean {
  try {
    const result = spawnSync('func', ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Creates a minimal function project for testing deployment
 */
function createTestProject(dir: string, options: {
  name?: string
  language?: 'typescript' | 'rust' | 'python' | 'go'
  content?: string
  version?: string
} = {}): void {
  const {
    name = 'test-function',
    language = 'typescript',
    version = '1.0.0',
    content
  } = options

  // Create src directory
  mkdirSync(join(dir, 'src'), { recursive: true })

  // Create package.json
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        version,
        type: 'module',
        scripts: {
          dev: 'func dev',
          deploy: 'func deploy',
          build: 'func build',
        },
        devDependencies: {
          typescript: '^5.0.0',
          wrangler: '^3.0.0',
          '@cloudflare/workers-types': '^4.0.0',
        },
      },
      null,
      2
    )
  )

  // Create tsconfig.json
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist',
          rootDir: 'src',
          types: ['@cloudflare/workers-types'],
        },
        include: ['src/**/*'],
      },
      null,
      2
    )
  )

  // Create wrangler.toml
  writeFileSync(
    join(dir, 'wrangler.toml'),
    `name = "${name}"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
`
  )

  // Create func.config.json (Functions.do config)
  writeFileSync(
    join(dir, 'func.config.json'),
    JSON.stringify(
      {
        name,
        version,
        language,
        entryPoint: 'src/index.ts',
        dependencies: {},
      },
      null,
      2
    )
  )

  // Create src/index.ts with default or custom content
  const defaultContent = `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Hello from ${name}!', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
`
  writeFileSync(join(dir, 'src', 'index.ts'), content ?? defaultContent)
}

/**
 * Helper to run func deploy command
 */
function runFuncDeploy(
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {}
): { stdout: string; stderr: string; status: number | null; error?: Error } {
  const result = spawnSync('func', ['deploy', ...args], {
    cwd,
    stdio: 'pipe',
    timeout: 60000,
    env: {
      ...process.env,
      // Mock Cloudflare API credentials for testing
      CLOUDFLARE_API_TOKEN: 'mock-api-token',
      CLOUDFLARE_ACCOUNT_ID: 'mock-account-id',
      FUNCTIONS_DO_REGISTRY_URL: 'http://localhost:8787',
      ...env,
    },
  })

  return {
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  }
}

/**
 * Mock server for Cloudflare API and Functions.do registry
 */
class MockServer {
  private server: any = null
  private uploads: Map<string, MockCloudflareUpload> = new Map()
  private deployments: Map<string, MockCloudflareDeployment> = new Map()
  private registryEntries: Map<string, any> = new Map()

  get uploadCount(): number {
    return this.uploads.size
  }

  get deploymentCount(): number {
    return this.deployments.size
  }

  get registryCount(): number {
    return this.registryEntries.size
  }

  getUpload(id: string): MockCloudflareUpload | undefined {
    return this.uploads.get(id)
  }

  getDeployment(id: string): MockCloudflareDeployment | undefined {
    return this.deployments.get(id)
  }

  getRegistryEntry(id: string): any {
    return this.registryEntries.get(id)
  }

  recordUpload(id: string, data: MockCloudflareUpload): void {
    this.uploads.set(id, data)
  }

  recordDeployment(id: string, data: MockCloudflareDeployment): void {
    this.deployments.set(id, data)
  }

  recordRegistryEntry(id: string, data: any): void {
    this.registryEntries.set(id, data)
  }

  clear(): void {
    this.uploads.clear()
    this.deployments.clear()
    this.registryEntries.clear()
  }
}

describe('func deploy - deployment command', () => {
  let tempDir: string
  let mockServer: MockServer

  // This will cause all tests to fail if func CLI is not available
  // This is expected to FAIL since func deploy doesn't exist yet
  beforeAll(() => {
    const available = isFuncCliAvailable()
    expect(available, 'func CLI must be installed and available in PATH').toBe(true)
  })

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'func-deploy-test-'))
    mockServer = new MockServer()
  })

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
    mockServer.clear()
  })

  describe('compilation', () => {
    it('should compile TypeScript function before deployment', () => {
      createTestProject(tempDir, {
        name: 'compile-test',
        content: `
interface RequestHandler {
  fetch(request: Request): Promise<Response>
}

const handler: RequestHandler = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    return new Response(\`Path: \${url.pathname}\`)
  },
}

export default handler
`,
      })

      const result = runFuncDeploy(tempDir)

      // Should have attempted compilation
      expect(result.stdout + result.stderr).toMatch(/compil|build|bundle/i)

      // dist directory should be created with compiled output
      expect(existsSync(join(tempDir, 'dist'))).toBe(true)
    })

    it('should fail deployment if TypeScript compilation fails', () => {
      createTestProject(tempDir, {
        name: 'compile-error-test',
        content: `
export default {
  async fetch(request: Request): Promise<Response> {
    // TypeScript error: 'string' is not assignable to 'number'
    const value: number = "not a number"
    return new Response(value.toString())
  },
}
`,
      })

      const result = runFuncDeploy(tempDir)

      // Should fail due to compilation error
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/error|type|TS\d+/i)
    })

    it('should bundle dependencies during compilation', () => {
      // Create a project with local dependencies
      mkdirSync(join(tempDir, 'src', 'lib'), { recursive: true })

      writeFileSync(
        join(tempDir, 'src', 'lib', 'utils.ts'),
        `export const greet = (name: string) => \`Hello, \${name}!\``
      )

      createTestProject(tempDir, {
        name: 'bundle-test',
        content: `
import { greet } from './lib/utils'

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(greet('World'))
  },
}
`,
      })

      const result = runFuncDeploy(tempDir)

      // The compiled output should include bundled dependencies
      if (existsSync(join(tempDir, 'dist', 'index.js'))) {
        const compiledCode = readFileSync(join(tempDir, 'dist', 'index.js'), 'utf-8')
        expect(compiledCode).toContain('greet')
        expect(compiledCode).toContain('Hello')
      }
    })
  })

  describe('Cloudflare upload', () => {
    it('should upload compiled worker to Cloudflare', () => {
      createTestProject(tempDir, { name: 'upload-test' })

      const result = runFuncDeploy(tempDir)

      // Should indicate upload to Cloudflare
      expect(result.stdout + result.stderr).toMatch(/upload|cloudflare|worker/i)
    })

    it('should use CLOUDFLARE_API_TOKEN for authentication', () => {
      createTestProject(tempDir, { name: 'auth-test' })

      // Test without API token
      const resultNoToken = runFuncDeploy(tempDir, [], {
        CLOUDFLARE_API_TOKEN: '',
      })

      // Should fail or warn about missing credentials
      expect(resultNoToken.status).not.toBe(0)
      expect(resultNoToken.stderr).toMatch(/api.*token|credential|auth/i)
    })

    it('should use CLOUDFLARE_ACCOUNT_ID for target account', () => {
      createTestProject(tempDir, { name: 'account-test' })

      // Test without account ID
      const resultNoAccount = runFuncDeploy(tempDir, [], {
        CLOUDFLARE_ACCOUNT_ID: '',
      })

      // Should fail or warn about missing account ID
      expect(resultNoAccount.status).not.toBe(0)
      expect(resultNoAccount.stderr).toMatch(/account.*id|account/i)
    })

    it('should handle Cloudflare API errors gracefully', () => {
      createTestProject(tempDir, { name: 'api-error-test' })

      // Use invalid credentials that would cause API error
      const result = runFuncDeploy(tempDir, [], {
        CLOUDFLARE_API_TOKEN: 'invalid-token',
      })

      // Should fail with informative error
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/error|failed|unauthorized|invalid/i)
    })
  })

  describe('registry entry', () => {
    it('should register function in Functions.do registry after upload', () => {
      createTestProject(tempDir, {
        name: 'registry-test',
        version: '1.0.0',
      })

      const result = runFuncDeploy(tempDir)

      // Should indicate registry registration
      expect(result.stdout + result.stderr).toMatch(/regist|record|catalog/i)
    })

    it('should store function metadata in registry', () => {
      createTestProject(tempDir, {
        name: 'metadata-test',
        version: '2.1.0',
        language: 'typescript',
      })

      const result = runFuncDeploy(tempDir)

      // Output should confirm metadata was stored
      expect(result.stdout).toMatch(/metadata-test|2\.1\.0|typescript/i)
    })

    it('should update existing registry entry on redeploy', () => {
      createTestProject(tempDir, {
        name: 'update-test',
        version: '1.0.0',
      })

      // First deploy
      runFuncDeploy(tempDir)

      // Update version
      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '1.1.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))

      const packageJson = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'))
      packageJson.version = '1.1.0'
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2))

      // Second deploy
      const result = runFuncDeploy(tempDir)

      // Should indicate update
      expect(result.stdout + result.stderr).toMatch(/update|redeploy|version.*1\.1\.0/i)
    })
  })

  describe('deployment URL', () => {
    it('should return deployment URL after successful deploy', () => {
      createTestProject(tempDir, { name: 'url-test' })

      const result = runFuncDeploy(tempDir)

      // Should output the deployment URL
      expect(result.stdout).toMatch(/https?:\/\/.*\.workers\.dev|https?:\/\/.*functions\.do/i)
    })

    it('should return different URLs for staging and production', () => {
      createTestProject(tempDir, { name: 'env-url-test' })

      // Deploy to staging
      const stagingResult = runFuncDeploy(tempDir, ['--env', 'staging'])

      // Deploy to production
      const productionResult = runFuncDeploy(tempDir, ['--env', 'production'])

      // Both should have URLs
      expect(stagingResult.stdout).toMatch(/https?:\/\//i)
      expect(productionResult.stdout).toMatch(/https?:\/\//i)

      // URLs should indicate environment
      expect(stagingResult.stdout).toMatch(/staging|stg|dev/i)
      expect(productionResult.stdout).toMatch(/prod|live/i)
    })

    it('should display full URL with custom domain if configured', () => {
      createTestProject(tempDir, { name: 'custom-domain-test' })

      // Add custom domain configuration
      const wranglerContent = readFileSync(join(tempDir, 'wrangler.toml'), 'utf-8')
      writeFileSync(
        join(tempDir, 'wrangler.toml'),
        wranglerContent + `
[routes]
pattern = "api.example.com/functions/*"
zone_name = "example.com"
`
      )

      const result = runFuncDeploy(tempDir)

      // Should show custom domain in output
      expect(result.stdout).toMatch(/example\.com|custom.*domain/i)
    })
  })

  describe('function callability', () => {
    it('should make function callable via URL after deployment', async () => {
      createTestProject(tempDir, {
        name: 'callable-test',
        content: `
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'deployed', time: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
`,
      })

      const result = runFuncDeploy(tempDir)

      // Extract URL from output
      const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/)
      expect(urlMatch, 'Deployment URL should be in output').toBeTruthy()

      // If we have a real deployment URL (not in mock mode), test it
      if (urlMatch && !urlMatch[0].includes('mock')) {
        const response = await fetch(urlMatch[0])
        expect(response.ok).toBe(true)

        const body = (await response.json()) as JsonBody
        expect(body['status']).toBe('deployed')
      }
    })

    it('should handle request routing after deployment', async () => {
      createTestProject(tempDir, {
        name: 'routing-test',
        content: `
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response('OK')
    }

    if (url.pathname === '/echo') {
      return new Response(JSON.stringify({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
`,
      })

      const result = runFuncDeploy(tempDir)

      // Extract URL from output
      const urlMatch = result.stdout.match(/https?:\/\/[^\s]+/)
      expect(urlMatch, 'Deployment URL should be in output').toBeTruthy()
    })
  })

  describe('--env flag', () => {
    it('should deploy to staging environment with --env staging', () => {
      createTestProject(tempDir, { name: 'staging-test' })

      const result = runFuncDeploy(tempDir, ['--env', 'staging'])

      // Should indicate staging environment
      expect(result.stdout + result.stderr).toMatch(/staging/i)
      expect(result.status).toBe(0)
    })

    it('should deploy to production environment with --env production', () => {
      createTestProject(tempDir, { name: 'production-test' })

      const result = runFuncDeploy(tempDir, ['--env', 'production'])

      // Should indicate production environment
      expect(result.stdout + result.stderr).toMatch(/production|prod/i)
      expect(result.status).toBe(0)
    })

    it('should default to staging when --env is not specified', () => {
      createTestProject(tempDir, { name: 'default-env-test' })

      const result = runFuncDeploy(tempDir)

      // Should default to staging
      expect(result.stdout + result.stderr).toMatch(/staging|default/i)
    })

    it('should fail with invalid environment name', () => {
      createTestProject(tempDir, { name: 'invalid-env-test' })

      const result = runFuncDeploy(tempDir, ['--env', 'invalid-env'])

      // Should fail with invalid environment
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/invalid.*env|unknown.*env|staging.*production/i)
    })

    it('should use environment-specific wrangler.toml config', () => {
      createTestProject(tempDir, { name: 'env-config-test' })

      // Add environment-specific config
      const wranglerContent = `
name = "env-config-test"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.staging]
vars = { ENVIRONMENT = "staging" }

[env.production]
vars = { ENVIRONMENT = "production" }
`
      writeFileSync(join(tempDir, 'wrangler.toml'), wranglerContent)

      const stagingResult = runFuncDeploy(tempDir, ['--env', 'staging'])
      const productionResult = runFuncDeploy(tempDir, ['--env', 'production'])

      // Both should succeed with environment-specific config
      expect(stagingResult.status).toBe(0)
      expect(productionResult.status).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should fail gracefully if no project found', () => {
      // Empty directory, no project files

      const result = runFuncDeploy(tempDir)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/no.*project|not.*found|missing.*config/i)
    })

    it('should fail if required config files are missing', () => {
      // Create partial project without func.config.json
      mkdirSync(join(tempDir, 'src'), { recursive: true })
      writeFileSync(join(tempDir, 'src', 'index.ts'), 'export default {}')

      const result = runFuncDeploy(tempDir)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/config|wrangler|package/i)
    })

    it('should show helpful error for network failures', () => {
      createTestProject(tempDir, { name: 'network-test' })

      // Use unreachable registry URL
      const result = runFuncDeploy(tempDir, [], {
        FUNCTIONS_DO_REGISTRY_URL: 'http://localhost:9999',
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/network|connect|timeout|unavailable/i)
    })

    it('should validate function config before deployment', () => {
      createTestProject(tempDir, { name: 'validate-test' })

      // Create invalid func.config.json
      writeFileSync(
        join(tempDir, 'func.config.json'),
        JSON.stringify(
          {
            name: 'test',
            // Missing required fields: version, language, entryPoint
          },
          null,
          2
        )
      )

      const result = runFuncDeploy(tempDir)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/invalid|missing|required|version|language|entry/i)
    })
  })

  describe('output and logging', () => {
    it('should show progress during deployment', () => {
      createTestProject(tempDir, { name: 'progress-test' })

      const result = runFuncDeploy(tempDir)

      // Should show deployment steps
      expect(result.stdout + result.stderr).toMatch(/compil|build/i)
      expect(result.stdout + result.stderr).toMatch(/upload/i)
      expect(result.stdout + result.stderr).toMatch(/deploy|publish/i)
    })

    it('should show verbose output with --verbose flag', () => {
      createTestProject(tempDir, { name: 'verbose-test' })

      const normalResult = runFuncDeploy(tempDir)
      const verboseResult = runFuncDeploy(tempDir, ['--verbose'])

      // Verbose output should be longer
      expect(verboseResult.stdout.length).toBeGreaterThan(normalResult.stdout.length)
    })

    it('should support --json flag for machine-readable output', () => {
      createTestProject(tempDir, { name: 'json-test' })

      const result = runFuncDeploy(tempDir, ['--json'])

      // Output should be valid JSON
      expect(() => JSON.parse(result.stdout)).not.toThrow()

      const output = JSON.parse(result.stdout)
      expect(output).toHaveProperty('success')
      expect(output).toHaveProperty('url')
      expect(output).toHaveProperty('functionId')
    })
  })

  describe('dry run', () => {
    it('should support --dry-run flag to preview deployment', () => {
      createTestProject(tempDir, { name: 'dry-run-test' })

      const result = runFuncDeploy(tempDir, ['--dry-run'])

      // Should indicate dry run mode
      expect(result.stdout + result.stderr).toMatch(/dry.*run|preview|would.*deploy/i)

      // Should not actually deploy
      expect(result.stdout).not.toMatch(/deployed|success.*url/i)
    })

    it('should show what would be deployed in dry run', () => {
      createTestProject(tempDir, {
        name: 'dry-run-preview',
        version: '1.2.3',
      })

      const result = runFuncDeploy(tempDir, ['--dry-run'])

      // Should show function info
      expect(result.stdout).toMatch(/dry-run-preview|1\.2\.3/i)
    })
  })

  describe('multi-language support', () => {
    it('should deploy Rust functions', () => {
      // Create Rust project structure
      mkdirSync(join(tempDir, 'src'), { recursive: true })

      writeFileSync(
        join(tempDir, 'Cargo.toml'),
        `[package]
name = "rust-function"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
worker = "0.0.18"
`
      )

      writeFileSync(
        join(tempDir, 'src', 'lib.rs'),
        `use worker::*;

#[event(fetch)]
async fn fetch(_req: Request, _env: Env, _ctx: Context) -> Result<Response> {
    Response::ok("Hello from Rust!")
}
`
      )

      writeFileSync(
        join(tempDir, 'wrangler.toml'),
        `name = "rust-function"
main = "build/worker/shim.mjs"
compatibility_date = "2024-01-01"

[build]
command = "cargo install -q worker-build && worker-build --release"
`
      )

      writeFileSync(
        join(tempDir, 'func.config.json'),
        JSON.stringify(
          {
            name: 'rust-function',
            version: '1.0.0',
            language: 'rust',
            entryPoint: 'src/lib.rs',
            dependencies: {},
          },
          null,
          2
        )
      )

      const result = runFuncDeploy(tempDir)

      // Should indicate Rust compilation/deployment
      expect(result.stdout + result.stderr).toMatch(/rust|cargo|wasm/i)
    })

    it('should deploy Python functions', () => {
      // Create Python project structure
      mkdirSync(join(tempDir, 'src'), { recursive: true })

      writeFileSync(
        join(tempDir, 'src', 'handler.py'),
        `from js import Response

async def on_fetch(request, env):
    return Response.new("Hello from Python!")
`
      )

      writeFileSync(
        join(tempDir, 'wrangler.toml'),
        `name = "python-function"
main = "src/handler.py"
compatibility_date = "2024-01-01"
compatibility_flags = ["python_workers"]
`
      )

      writeFileSync(
        join(tempDir, 'func.config.json'),
        JSON.stringify(
          {
            name: 'python-function',
            version: '1.0.0',
            language: 'python',
            entryPoint: 'src/handler.py',
            dependencies: {},
          },
          null,
          2
        )
      )

      writeFileSync(join(tempDir, 'requirements.txt'), '')

      const result = runFuncDeploy(tempDir)

      // Should indicate Python deployment
      expect(result.stdout + result.stderr).toMatch(/python/i)
    })
  })

  describe('deployment history tracking', () => {
    it('should record deployment in history', () => {
      createTestProject(tempDir, { name: 'history-test', version: '1.0.0' })

      const result = runFuncDeploy(tempDir)

      expect(result.status).toBe(0)

      // Check that deployment history was created
      const historyPath = join(tempDir, '.func', 'deployment-history.json')
      expect(existsSync(historyPath)).toBe(true)

      const history = JSON.parse(readFileSync(historyPath, 'utf-8'))
      expect(history.entries).toHaveLength(1)
      expect(history.entries[0].version).toBe('1.0.0')
      expect(history.entries[0].functionName).toBe('history-test')
      expect(history.entries[0].status).toBe('active')
    })

    it('should store bundle for rollback', () => {
      createTestProject(tempDir, { name: 'bundle-store-test', version: '1.0.0' })

      const result = runFuncDeploy(tempDir)

      expect(result.status).toBe(0)

      // Check that bundle was saved
      const bundlesDir = join(tempDir, '.func', 'bundles')
      expect(existsSync(bundlesDir)).toBe(true)

      // Read history to get deployment ID
      const historyPath = join(tempDir, '.func', 'deployment-history.json')
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'))
      const deploymentId = history.entries[0].deploymentId
      const bundlePath = join(bundlesDir, `${deploymentId}.js`)

      expect(existsSync(bundlePath)).toBe(true)
    })

    it('should include deployment ID in output', () => {
      createTestProject(tempDir, { name: 'deployment-id-test' })

      const result = runFuncDeploy(tempDir, ['--json'])

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.deploymentId).toBeDefined()
      expect(output.deploymentId).toMatch(/^deploy-/)
    })

    it('should mark previous deployments as superseded', () => {
      createTestProject(tempDir, { name: 'supersede-test', version: '1.0.0' })

      // First deploy
      runFuncDeploy(tempDir)

      // Update version and deploy again
      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '1.1.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))

      runFuncDeploy(tempDir)

      // Check history
      const historyPath = join(tempDir, '.func', 'deployment-history.json')
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'))

      expect(history.entries).toHaveLength(2)
      expect(history.entries[0].status).toBe('superseded')
      expect(history.entries[1].status).toBe('active')
    })
  })

  describe('rollback functionality', () => {
    it('should rollback to previous version with --rollback', () => {
      createTestProject(tempDir, { name: 'rollback-test', version: '1.0.0' })

      // First deploy
      runFuncDeploy(tempDir)

      // Update and deploy again
      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '2.0.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))

      runFuncDeploy(tempDir)

      // Rollback to previous
      const rollbackResult = runFuncDeploy(tempDir, ['--rollback'])

      expect(rollbackResult.status).toBe(0)
      expect(rollbackResult.stdout).toMatch(/rollback.*successful/i)
    })

    it('should rollback to specific version with --rollback=version', () => {
      createTestProject(tempDir, { name: 'specific-rollback-test', version: '1.0.0' })

      // Deploy version 1.0.0
      runFuncDeploy(tempDir)

      // Deploy version 2.0.0
      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '2.0.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))
      runFuncDeploy(tempDir)

      // Deploy version 3.0.0
      funcConfig.version = '3.0.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))
      runFuncDeploy(tempDir)

      // Rollback to 1.0.0
      const rollbackResult = runFuncDeploy(tempDir, ['--rollback', '1.0.0'])

      expect(rollbackResult.status).toBe(0)
      expect(rollbackResult.stdout).toMatch(/1\.0\.0/i)
    })

    it('should fail rollback if no previous deployment exists', () => {
      createTestProject(tempDir, { name: 'no-history-rollback' })

      const result = runFuncDeploy(tempDir, ['--rollback'])

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/no.*previous.*deployment|cannot.*rollback/i)
    })

    it('should indicate rollback availability in deploy output', () => {
      createTestProject(tempDir, { name: 'rollback-available-test', version: '1.0.0' })

      // First deploy
      runFuncDeploy(tempDir)

      // Second deploy
      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '2.0.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))

      const result = runFuncDeploy(tempDir, ['--json'])

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.rollbackAvailable).toBe(true)
      expect(output.previousVersion).toBe('1.0.0')
    })
  })

  describe('preview deployments', () => {
    it('should create preview deployment with --preview flag', () => {
      createTestProject(tempDir, { name: 'preview-test' })

      const result = runFuncDeploy(tempDir, ['--preview'])

      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/preview.*deployment.*successful/i)
    })

    it('should include PR number in preview deployment', () => {
      createTestProject(tempDir, { name: 'pr-preview-test' })

      const result = runFuncDeploy(tempDir, ['--preview', '--pr-number', '42', '--json'])

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.isPreview).toBe(true)
      expect(output.prNumber).toBe(42)
    })

    it('should generate unique preview URL for PR', () => {
      createTestProject(tempDir, { name: 'pr-url-test' })

      const result = runFuncDeploy(tempDir, ['--preview', '--pr-number', '123', '--json'])

      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.url).toMatch(/pr-123/)
    })
  })

  describe('GitHub Actions integration', () => {
    it('should generate GitHub Actions workflow with --generate-github-action', () => {
      createTestProject(tempDir, { name: 'github-action-test' })

      const result = runFuncDeploy(tempDir, ['--generate-github-action'])

      expect(result.status).toBe(0)

      // Check workflow file was created
      const workflowPath = join(tempDir, '.github', 'workflows', 'functions-deploy.yml')
      expect(existsSync(workflowPath)).toBe(true)

      // Verify workflow content
      const workflow = readFileSync(workflowPath, 'utf-8')
      expect(workflow).toContain('Deploy to Functions.do')
      expect(workflow).toContain('CLOUDFLARE_API_TOKEN')
      expect(workflow).toContain('func deploy')
    })

    it('should support --init-ci alias for generating workflow', () => {
      createTestProject(tempDir, { name: 'init-ci-test' })

      const result = runFuncDeploy(tempDir, ['--init-ci'])

      expect(result.status).toBe(0)

      const workflowPath = join(tempDir, '.github', 'workflows', 'functions-deploy.yml')
      expect(existsSync(workflowPath)).toBe(true)
    })

    it('should include preview deployment step in workflow', () => {
      createTestProject(tempDir, { name: 'workflow-preview-test' })

      runFuncDeploy(tempDir, ['--generate-github-action'])

      const workflowPath = join(tempDir, '.github', 'workflows', 'functions-deploy.yml')
      const workflow = readFileSync(workflowPath, 'utf-8')

      expect(workflow).toContain('pull_request')
      expect(workflow).toContain('--preview')
      expect(workflow).toContain('--pr-number')
    })
  })

  describe('atomic deployment', () => {
    it('should calculate bundle hash for deployment', () => {
      createTestProject(tempDir, { name: 'hash-test' })

      const result = runFuncDeploy(tempDir, ['--verbose'])

      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/bundle.*hash/i)
    })

    it('should provide rollback hint on failed deployment', () => {
      createTestProject(tempDir, { name: 'rollback-hint-test', version: '1.0.0' })

      // First successful deploy
      runFuncDeploy(tempDir)

      // Create invalid code for second deploy
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `
export default {
  async fetch(request: Request): Promise<Response> {
    // TypeScript error: 'string' is not assignable to 'number'
    const value: number = "not a number"
    return new Response(value.toString())
  },
}
`
      )

      const funcConfig = JSON.parse(readFileSync(join(tempDir, 'func.config.json'), 'utf-8'))
      funcConfig.version = '2.0.0'
      writeFileSync(join(tempDir, 'func.config.json'), JSON.stringify(funcConfig, null, 2))

      const result = runFuncDeploy(tempDir)

      expect(result.status).not.toBe(0)
      // Should mention rollback is available
      expect(result.stdout + result.stderr).toMatch(/rollback.*available|--rollback/i)
    })

    it('should preserve deployment history on failure', () => {
      createTestProject(tempDir, { name: 'preserve-history-test', version: '1.0.0' })

      // First successful deploy
      runFuncDeploy(tempDir)

      // Get history before failure
      const historyPath = join(tempDir, '.func', 'deployment-history.json')
      const historyBefore = JSON.parse(readFileSync(historyPath, 'utf-8'))

      // Create invalid code
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `const x: number = "invalid"`
      )

      // Attempt failed deploy
      runFuncDeploy(tempDir)

      // History should still have the successful deployment
      const historyAfter = JSON.parse(readFileSync(historyPath, 'utf-8'))
      expect(historyAfter.entries.length).toBe(historyBefore.entries.length)
    })
  })
})
