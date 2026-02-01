/**
 * Init Command - Create a new function project
 *
 * Creates a new functions.do project with the specified template.
 * Supports TypeScript, Rust, Go, and Python.
 */

import { join } from 'path'
import type { CLIContext, InitOptions, CommandResult, ProjectTemplate } from '../types.js'

/**
 * Validate project name
 */
function isValidProjectName(name: string): boolean {
  if (!name || name.trim() === '') return false
  // Must start with a letter or number, can contain letters, numbers, hyphens, underscores
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)
}

/**
 * Get current date in YYYY-MM-DD format for compatibility_date
 */
function getCompatibilityDate(): string {
  const now = new Date()
  return now.toISOString().split('T')[0]
}

/**
 * TypeScript project template files
 */
function getTypeScriptFiles(name: string): Array<{ path: string; content: string }> {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name,
        version: '0.0.1',
        type: 'module',
        scripts: {
          dev: 'wrangler dev',
          deploy: 'wrangler deploy',
          build: 'tsc',
        },
        devDependencies: {
          '@cloudflare/workers-types': '^4.20250109.0',
          typescript: '^5.7.0',
          wrangler: '^4.0.0',
        },
      }, null, 2),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          lib: ['ES2022'],
          types: ['@cloudflare/workers-types'],
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['src/**/*'],
      }, null, 2),
    },
    {
      path: 'wrangler.toml',
      content: `name = "${name}"
main = "src/index.ts"
compatibility_date = "${getCompatibilityDate()}"
`,
    },
    {
      path: 'src/index.ts',
      content: `/**
 * ${name} - A functions.do serverless function
 */

export interface Env {
  // Add your bindings here, e.g.:
  // MY_KV: KVNamespace;
  // MY_BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle different routes
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        message: 'Hello from ${name}!',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/health') {
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },
};
`,
    },
    {
      path: '.gitignore',
      content: `node_modules
dist
.wrangler
.dev.vars
*.log
`,
    },
  ]
}

/**
 * Rust project template files
 */
function getRustFiles(name: string): Array<{ path: string; content: string }> {
  return [
    {
      path: 'Cargo.toml',
      content: `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
worker = "0.0.21"
wasm-bindgen = "0.2"
wasm-bindgen-futures = "0.4"
console_error_panic_hook = "0.1"

[profile.release]
opt-level = "s"
lto = true
`,
    },
    {
      path: 'wrangler.toml',
      content: `name = "${name}"
main = "build/worker/shim.mjs"
compatibility_date = "${getCompatibilityDate()}"

[build]
command = "worker-build --release"
`,
    },
    {
      path: 'src/lib.rs',
      content: `use worker::*;

#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();

    let router = Router::new();

    router
        .get("/", |_, _| {
            Response::ok("Hello from ${name}!")
        })
        .get("/health", |_, _| {
            Response::ok("OK")
        })
        .run(req, env)
        .await
}
`,
    },
    {
      path: '.gitignore',
      content: `target
Cargo.lock
.wrangler
build
*.log
`,
    },
  ]
}

/**
 * Go project template files
 */
function getGoFiles(name: string): Array<{ path: string; content: string }> {
  return [
    {
      path: 'go.mod',
      content: `module ${name}

go 1.21

require github.com/syumai/workers v0.23.0
`,
    },
    {
      path: 'wrangler.toml',
      content: `name = "${name}"
main = "build/worker.wasm"
compatibility_date = "${getCompatibilityDate()}"

[build]
command = "tinygo build -o build/worker.wasm -target wasm ./..."
`,
    },
    {
      path: 'main.go',
      content: `package main

import (
	"encoding/json"
	"net/http"

	"github.com/syumai/workers"
)

func main() {
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/health", handleHealth)
	workers.Serve(nil)
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]string{
		"message": "Hello from ${name}!",
	}
	json.NewEncoder(w).Encode(response)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("OK"))
}
`,
    },
    {
      path: 'Makefile',
      content: `build:
	tinygo build -o build/worker.wasm -target wasm ./...

dev:
	wrangler dev

deploy:
	wrangler deploy

.PHONY: build dev deploy
`,
    },
    {
      path: '.gitignore',
      content: `build
*.wasm
.wrangler
*.log
`,
    },
  ]
}

/**
 * Python project template files
 */
function getPythonFiles(name: string): Array<{ path: string; content: string }> {
  return [
    {
      path: 'pyproject.toml',
      content: `[project]
name = "${name}"
version = "0.1.0"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
`,
    },
    {
      path: 'wrangler.toml',
      content: `name = "${name}"
main = "src/handler.py"
compatibility_date = "${getCompatibilityDate()}"
compatibility_flags = ["python_workers"]
`,
    },
    {
      path: 'src/handler.py',
      content: `"""
${name} - A functions.do Python serverless function
"""

from js import Response, JSON


async def on_fetch(request, env):
    """Handle incoming HTTP requests."""
    url = request.url

    if "/" in url and url.endswith("/"):
        return Response.new(
            JSON.stringify({"message": "Hello from ${name}!"}),
            headers={"Content-Type": "application/json"},
        )

    if "/health" in url:
        return Response.new("OK")

    return Response.new("Not Found", status=404)
`,
    },
    {
      path: 'requirements.txt',
      content: `# Add your Python dependencies here
`,
    },
    {
      path: '.gitignore',
      content: `__pycache__
*.pyc
.venv
.wrangler
*.log
.pytest_cache
`,
    },
  ]
}

/**
 * Get template files for a given template type
 */
function getTemplateFiles(template: ProjectTemplate, name: string): Array<{ path: string; content: string }> {
  switch (template) {
    case 'typescript':
      return getTypeScriptFiles(name)
    case 'rust':
      return getRustFiles(name)
    case 'go':
      return getGoFiles(name)
    case 'python':
      return getPythonFiles(name)
    default:
      return getTypeScriptFiles(name)
  }
}

/**
 * Get next steps message for a template
 */
function getNextSteps(template: ProjectTemplate, name: string): string[] {
  const cdStep = `cd ${name}`

  switch (template) {
    case 'typescript':
      return [
        cdStep,
        'npm install',
        'npm run dev',
        '',
        'To deploy:',
        'dotdo deploy',
      ]
    case 'rust':
      return [
        cdStep,
        'cargo build --release',
        'npx wrangler dev',
        '',
        'To deploy:',
        'dotdo deploy',
      ]
    case 'go':
      return [
        cdStep,
        'go mod tidy',
        'make build',
        'npx wrangler dev',
        '',
        'To deploy:',
        'dotdo deploy',
      ]
    case 'python':
      return [
        cdStep,
        'python -m venv .venv',
        'source .venv/bin/activate',
        'pip install -r requirements.txt',
        'npx wrangler dev',
        '',
        'To deploy:',
        'dotdo deploy',
      ]
    default:
      return [cdStep, 'npm install', 'npm run dev']
  }
}

/**
 * Run the init command
 */
export async function runInit(
  name: string,
  options: InitOptions,
  context: CLIContext
): Promise<CommandResult> {
  const { fs, stdout, stderr, cwd } = context
  const template = options.template || 'typescript'

  // Validate project name
  if (!name || name.trim() === '') {
    stderr('Error: Project name is required')
    stderr('Usage: dotdo init <name> [--template <template>]')
    return { exitCode: 1, error: 'Project name is required' }
  }

  if (!isValidProjectName(name)) {
    stderr(`Error: Invalid project name "${name}"`)
    stderr('Project name must start with a letter or number and can only contain letters, numbers, hyphens, and underscores.')
    return { exitCode: 1, error: `Invalid project name: ${name}` }
  }

  // Validate template
  const validTemplates = ['typescript', 'rust', 'go', 'python']
  if (!validTemplates.includes(template)) {
    stderr(`Error: Invalid template "${template}"`)
    stderr(`Available templates: ${validTemplates.join(', ')}`)
    return { exitCode: 1, error: `Invalid template: ${template}. Available: ${validTemplates.join(', ')}` }
  }

  // Check if directory exists
  const projectDir = join(cwd, name)
  const exists = await fs.exists(projectDir)

  if (exists && !options.force) {
    stderr(`Error: Directory "${name}" already exists`)
    stderr('Use --force to overwrite')
    return { exitCode: 1, error: `Directory "${name}" already exists` }
  }

  try {
    // Create project directory
    await fs.mkdir(projectDir, { recursive: true })

    // Get template files
    const files = getTemplateFiles(template, name)

    // Create all files
    for (const file of files) {
      const filePath = join(projectDir, file.path)
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'))

      // Create parent directories if needed
      if (fileDir !== projectDir && file.path.includes('/')) {
        await fs.mkdir(fileDir, { recursive: true })
      }

      await fs.writeFile(filePath, file.content)
    }

    // Output success message
    stdout('')
    stdout(`Successfully created ${template} project: ${name}`)
    stdout('')
    stdout('Next steps:')
    stdout('')

    const steps = getNextSteps(template, name)
    for (const step of steps) {
      stdout(`  ${step}`)
    }

    stdout('')
    stdout('Documentation: https://functions.do/docs')
    stdout('')

    return { exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr(`Error: Failed to create project: ${message}`)
    return { exitCode: 1, error: message }
  }
}
