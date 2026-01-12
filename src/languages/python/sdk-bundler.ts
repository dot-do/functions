/**
 * Python SDK Bundler for Functions.do
 *
 * This module handles bundling Python dependencies for deployment
 * to Cloudflare Workers via Pyodide.
 *
 * Key responsibilities:
 * 1. Parse requirements.txt and pyproject.toml
 * 2. Validate Pyodide compatibility
 * 3. Generate optimized dependency manifests
 * 4. Create SDK scaffolding for new projects
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import {
  parseRequirementsTxt,
  parsePyprojectToml,
  parseDependenciesFromDir,
  generateRequirementsTxt,
  normalizePackageName,
  type PythonDependency,
  type DependencyParseResult,
} from './dependency-parser'
import {
  checkPyodideCompat,
  filterCompatibleDependencies,
  isPackageCompatible,
  type PyodideCompatResult,
} from './pyodide-compat'

/**
 * Result of bundling Python dependencies
 */
export interface BundleResult {
  /**
   * Successfully bundled dependencies
   */
  dependencies: PythonDependency[]

  /**
   * Dependencies that were excluded due to incompatibility
   */
  excluded: Array<{
    name: string
    reason: string
    suggestion?: string
  }>

  /**
   * Generated requirements.txt content for Pyodide
   */
  requirementsTxt: string

  /**
   * Generated package manifest for the runtime
   */
  manifest: PackageManifest

  /**
   * Pyodide compatibility report
   */
  compatibility: PyodideCompatResult

  /**
   * Warnings and recommendations
   */
  warnings: string[]
}

/**
 * Package manifest for Pyodide runtime
 */
export interface PackageManifest {
  /**
   * List of packages to preload
   */
  packages: string[]

  /**
   * Standard library modules to preload
   */
  stdlib: string[]

  /**
   * Python version requirement
   */
  pythonVersion?: string

  /**
   * Entry point for the handler
   */
  entryPoint?: string

  /**
   * Memory snapshot configuration
   */
  snapshot?: {
    enabled: boolean
    preloadModules: string[]
  }
}

/**
 * SDK Template configuration
 */
export interface SdkTemplateConfig {
  /**
   * Project name
   */
  name: string

  /**
   * Project description
   */
  description?: string

  /**
   * Author name
   */
  author?: string

  /**
   * Initial dependencies
   */
  dependencies?: string[]

  /**
   * Enable memory snapshots
   */
  enableSnapshots?: boolean

  /**
   * Modules to preload for snapshots
   */
  preloadModules?: string[]

  /**
   * Include example RPC methods
   */
  includeExamples?: boolean
}

/**
 * Bundle Python dependencies for deployment
 */
export async function bundleDependencies(
  projectDir: string,
  options: {
    excludeDevDeps?: boolean
    strict?: boolean
    verbose?: boolean
  } = {}
): Promise<BundleResult> {
  const { excludeDevDeps = true, strict = false, verbose = false } = options

  // Parse dependencies from project
  const parseResult = await parseDependenciesFromDir(projectDir)

  // Filter out dev dependencies if requested
  let dependencies = parseResult.dependencies
  if (excludeDevDeps) {
    dependencies = dependencies.filter((d) => !d.isDev)
  }

  // Check Pyodide compatibility
  const compatibility = checkPyodideCompat(dependencies, parseResult.pythonVersion)

  // Filter incompatible dependencies
  const { compatible } = filterCompatibleDependencies(dependencies)

  // Build excluded list from compatibility check (which includes suggestions)
  const excluded = compatibility.incompatiblePackages

  // In strict mode, fail if there are incompatible packages
  if (strict && excluded.length > 0) {
    throw new Error(
      `Incompatible packages found: ${excluded.map((e) => e.name).join(', ')}. ` +
        `Use --no-strict to exclude them automatically.`
    )
  }

  // Generate requirements.txt for Pyodide
  const requirementsTxt = generateRequirementsTxt(compatible)

  // Build package manifest
  const manifest = buildPackageManifest(compatible, parseResult)

  // Collect all warnings
  const warnings: string[] = [
    ...(parseResult.warnings || []),
    ...compatibility.warnings,
  ]

  if (verbose) {
    if (compatibility.unknownPackages.length > 0) {
      warnings.push(
        `Unknown packages (may work if pure Python): ${compatibility.unknownPackages.join(', ')}`
      )
    }
  }

  return {
    dependencies: compatible,
    excluded,
    requirementsTxt,
    manifest,
    compatibility,
    warnings,
  }
}

/**
 * Build package manifest for Pyodide runtime
 */
function buildPackageManifest(
  dependencies: PythonDependency[],
  parseResult: DependencyParseResult
): PackageManifest {
  // Extract package names
  const packages = dependencies.map((d) => d.name)

  // Determine standard library modules to preload
  const stdlib = extractStdlibImports(packages)

  // Build manifest
  const manifest: PackageManifest = {
    packages,
    stdlib,
  }

  if (parseResult.pythonVersion) {
    manifest.pythonVersion = parseResult.pythonVersion
  }

  if (parseResult.entryPoints) {
    // Find the main entry point
    const handler =
      parseResult.entryPoints['handler'] ||
      parseResult.entryPoints['main'] ||
      Object.values(parseResult.entryPoints)[0]
    if (handler) {
      manifest.entryPoint = handler
    }
  }

  return manifest
}

/**
 * Extract likely standard library imports based on package names
 */
function extractStdlibImports(packages: string[]): string[] {
  const stdlib = new Set<string>()

  // Always include common modules
  const commonModules = ['json', 'datetime', 're', 'collections', 'typing', 'dataclasses']
  commonModules.forEach((m) => stdlib.add(m))

  // Add modules likely needed by packages
  for (const pkg of packages) {
    const normalized = pkg.toLowerCase()

    if (normalized.includes('http') || normalized.includes('request')) {
      stdlib.add('urllib')
      stdlib.add('ssl')
    }

    if (normalized.includes('json') || normalized.includes('pydantic')) {
      stdlib.add('json')
    }

    if (normalized.includes('date') || normalized.includes('time')) {
      stdlib.add('datetime')
      stdlib.add('calendar')
    }

    if (normalized.includes('yaml') || normalized.includes('toml')) {
      stdlib.add('tomllib')
    }

    if (normalized.includes('async') || normalized.includes('aio')) {
      stdlib.add('asyncio')
    }

    if (normalized.includes('math') || normalized.includes('num') || normalized.includes('sci')) {
      stdlib.add('math')
      stdlib.add('decimal')
      stdlib.add('fractions')
    }

    if (normalized.includes('log')) {
      stdlib.add('logging')
    }

    if (normalized.includes('hash') || normalized.includes('crypt')) {
      stdlib.add('hashlib')
      stdlib.add('hmac')
      stdlib.add('secrets')
    }

    if (normalized.includes('zip') || normalized.includes('compress')) {
      stdlib.add('zlib')
      stdlib.add('gzip')
    }

    if (normalized.includes('csv') || normalized.includes('data')) {
      stdlib.add('csv')
    }

    if (normalized.includes('xml') || normalized.includes('html')) {
      stdlib.add('xml')
      stdlib.add('html')
    }
  }

  return Array.from(stdlib).sort()
}

/**
 * Parse and validate a requirements.txt file
 */
export async function parseAndValidateRequirements(
  filePath: string
): Promise<{
  dependencies: PythonDependency[]
  compatibility: PyodideCompatResult
  warnings: string[]
}> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parseResult = parseRequirementsTxt(content)

  const compatibility = checkPyodideCompat(parseResult.dependencies)

  return {
    dependencies: parseResult.dependencies,
    compatibility,
    warnings: [...(parseResult.warnings || []), ...compatibility.warnings],
  }
}

/**
 * Parse and validate a pyproject.toml file
 */
export async function parseAndValidatePyproject(
  filePath: string
): Promise<{
  result: DependencyParseResult
  compatibility: PyodideCompatResult
  warnings: string[]
}> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parseResult = parsePyprojectToml(content)

  const compatibility = checkPyodideCompat(parseResult.dependencies, parseResult.pythonVersion)

  return {
    result: parseResult,
    compatibility,
    warnings: [...(parseResult.warnings || []), ...compatibility.warnings],
  }
}

/**
 * Generate SDK scaffolding for a new Python project
 */
export async function generateSdkScaffolding(
  targetDir: string,
  config: SdkTemplateConfig
): Promise<void> {
  // Create directories
  await fs.mkdir(targetDir, { recursive: true })
  await fs.mkdir(path.join(targetDir, 'src'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'tests'), { recursive: true })

  // Generate pyproject.toml
  const pyprojectContent = generatePyprojectToml(config)
  await fs.writeFile(path.join(targetDir, 'pyproject.toml'), pyprojectContent)

  // Generate requirements.txt
  const requirementsContent = generateRequirementsFile(config)
  await fs.writeFile(path.join(targetDir, 'requirements.txt'), requirementsContent)

  // Generate src/__init__.py
  const initContent = generateInitPy(config)
  await fs.writeFile(path.join(targetDir, 'src', '__init__.py'), initContent)

  // Generate src/handler.py
  const handlerContent = generateHandlerPy(config)
  await fs.writeFile(path.join(targetDir, 'src', 'handler.py'), handlerContent)

  // Generate README.md
  const readmeContent = generateReadme(config)
  await fs.writeFile(path.join(targetDir, 'README.md'), readmeContent)

  // Generate tests/test_handler.py
  const testContent = generateTestHandler(config)
  await fs.writeFile(path.join(targetDir, 'tests', 'test_handler.py'), testContent)
}

/**
 * Generate pyproject.toml content
 */
function generatePyprojectToml(config: SdkTemplateConfig): string {
  const name = normalizePackageName(config.name)
  const description = config.description || `A serverless function for Functions.do`

  const dependencies = config.dependencies || []
  const depsStr = dependencies.length > 0 ? dependencies.map((d) => `    "${d}",`).join('\n') : ''

  const preloadModules = config.preloadModules || ['json', 'datetime', 're']
  const preloadStr = preloadModules.map((m) => `    "${m}",`).join('\n')

  return `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${name}"
version = "0.1.0"
description = "${description}"
readme = "README.md"
requires-python = ">=3.10"
license = "MIT"
keywords = ["serverless", "functions", "cloudflare", "workers"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Topic :: Internet :: WWW/HTTP",
    "Typing :: Typed",
]
dependencies = [
${depsStr}
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "mypy>=1.0.0",
    "ruff>=0.1.0",
]

[project.scripts]
${name} = "src.handler:main"

[project.entry-points."functions.do"]
handler = "src.handler:handler"

[tool.hatch.build.targets.wheel]
packages = ["src"]

[tool.ruff]
target-version = "py310"
line-length = 100
select = [
    "E",   # pycodestyle errors
    "W",   # pycodestyle warnings
    "F",   # pyflakes
    "I",   # isort
    "C4",  # flake8-comprehensions
    "B",   # flake8-bugbear
    "UP",  # pyupgrade
]
ignore = [
    "E501",  # line too long (handled by formatter)
]

[tool.mypy]
python_version = "3.10"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
strict = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

# Functions.do configuration
[tool.functions-do]
runtime = "python"
handler = "src.handler:handler"

[tool.functions-do.snapshot]
enabled = ${config.enableSnapshots !== false}
preload_modules = [
${preloadStr}
]

[tool.functions-do.env]
# LOG_LEVEL = "INFO"

[tool.functions-do.bindings]
# kv_namespaces = ["MY_KV"]
# d1_databases = ["MY_DB"]
# r2_buckets = ["MY_BUCKET"]

[tool.functions-do.build]
minify = true
sourcemap = true
`
}

/**
 * Generate requirements.txt content
 */
function generateRequirementsFile(config: SdkTemplateConfig): string {
  const lines = [
    '# Functions.do Python SDK Dependencies',
    '# ==================================',
    '#',
    '# Core dependencies for Functions.do serverless functions.',
    '# These packages should be compatible with Pyodide (Python in WebAssembly).',
    '#',
    '# For local development, install with:',
    '#   pip install -r requirements.txt',
    '#',
    '# For production deployment, only Pyodide-compatible packages are supported.',
    '# See: https://pyodide.org/en/stable/usage/packages-in-pyodide.html',
    '',
  ]

  if (config.dependencies && config.dependencies.length > 0) {
    lines.push('# Project dependencies')
    for (const dep of config.dependencies) {
      lines.push(dep)
    }
    lines.push('')
  }

  lines.push('# Development dependencies (not needed in production)')
  lines.push('# pytest>=7.0.0')
  lines.push('# mypy>=1.0.0')
  lines.push('# ruff>=0.1.0')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate src/__init__.py content
 */
function generateInitPy(config: SdkTemplateConfig): string {
  return `"""
Functions.do Python Handler Package

This package contains the main handler for the serverless function.
"""

from .handler import handler

__all__ = ["handler"]
__version__ = "0.1.0"
`
}

/**
 * Generate src/handler.py content
 */
function generateHandlerPy(config: SdkTemplateConfig): string {
  const exampleMethods = config.includeExamples !== false ? `
    # Example RPC methods - add your own or remove these

    def ping(self) -> str:
        """Simple health check"""
        return "pong"

    def echo(self, message: str) -> str:
        """Echo back the message"""
        return message

    def add(self, a: int, b: int) -> int:
        """Add two numbers"""
        return a + b

    def info(self) -> dict[str, Any]:
        """Get handler information"""
        return {
            "name": "${config.name}",
            "version": "0.1.0",
            "runtime": "python",
            "methods": self._get_methods(),
        }
` : ''

  return `"""
Functions.do Python Handler

This module implements a serverless function handler compatible with
Functions.do and Cloudflare Workers Python (Pyodide).

The handler uses capnweb-style RPC for type-safe communication with
JavaScript and other language runtimes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, TypeVar, Generic, Optional, Union, Awaitable
from enum import Enum

# Type variables for generic handlers
T = TypeVar("T")
R = TypeVar("R")


# =============================================================================
# Core Types
# =============================================================================


class RequestMethod(Enum):
    """HTTP request methods"""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"


@dataclass
class Headers:
    """HTTP headers wrapper with case-insensitive access"""
    _headers: dict[str, str] = field(default_factory=dict)

    def get(self, key: str, default: str | None = None) -> str | None:
        """Get a header value (case-insensitive)"""
        return self._headers.get(key.lower(), default)

    def set(self, key: str, value: str) -> None:
        """Set a header value"""
        self._headers[key.lower()] = value

    def items(self) -> list[tuple[str, str]]:
        """Get all headers as key-value pairs"""
        return list(self._headers.items())

    def to_dict(self) -> dict[str, str]:
        """Convert to dictionary"""
        return dict(self._headers)

    @classmethod
    def from_dict(cls, headers: dict[str, str]) -> "Headers":
        """Create from dictionary"""
        h = cls()
        for k, v in headers.items():
            h.set(k, v)
        return h


@dataclass
class Request:
    """
    Incoming request to the function.

    This mirrors the Cloudflare Workers Request API for compatibility.
    """
    method: RequestMethod
    url: str
    headers: Headers
    body: bytes | None = None
    cf: dict[str, Any] = field(default_factory=dict)

    @property
    def path(self) -> str:
        """Extract path from URL"""
        from urllib.parse import urlparse
        return urlparse(self.url).path

    @property
    def query(self) -> dict[str, str]:
        """Extract query parameters from URL"""
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.url)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def json(self) -> Any:
        """Parse body as JSON"""
        if self.body is None:
            return None
        return json.loads(self.body.decode("utf-8"))

    def text(self) -> str:
        """Get body as text"""
        if self.body is None:
            return ""
        return self.body.decode("utf-8")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Request":
        """Create Request from dictionary (for capnweb deserialization)"""
        return cls(
            method=RequestMethod(data.get("method", "GET")),
            url=data.get("url", "/"),
            headers=Headers.from_dict(data.get("headers", {})),
            body=data.get("body", "").encode() if data.get("body") else None,
            cf=data.get("cf", {}),
        )


@dataclass
class Response:
    """
    Outgoing response from the function.

    This mirrors the Cloudflare Workers Response API for compatibility.
    """
    body: str | bytes | None = None
    status: int = 200
    headers: Headers = field(default_factory=Headers)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (for capnweb serialization)"""
        body = self.body
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        return {
            "body": body,
            "status": self.status,
            "headers": self.headers.to_dict(),
        }

    @classmethod
    def json(cls, data: Any, status: int = 200) -> "Response":
        """Create a JSON response"""
        headers = Headers()
        headers.set("content-type", "application/json")
        return cls(
            body=json.dumps(data),
            status=status,
            headers=headers,
        )

    @classmethod
    def text(cls, text: str, status: int = 200) -> "Response":
        """Create a plain text response"""
        headers = Headers()
        headers.set("content-type", "text/plain; charset=utf-8")
        return cls(body=text, status=status, headers=headers)

    @classmethod
    def html(cls, html: str, status: int = 200) -> "Response":
        """Create an HTML response"""
        headers = Headers()
        headers.set("content-type", "text/html; charset=utf-8")
        return cls(body=html, status=status, headers=headers)

    @classmethod
    def redirect(cls, url: str, status: int = 302) -> "Response":
        """Create a redirect response"""
        headers = Headers()
        headers.set("location", url)
        return cls(body=None, status=status, headers=headers)


# =============================================================================
# RPC Integration
# =============================================================================


@dataclass
class RpcCall:
    """
    Represents an incoming RPC call via capnweb protocol.
    """
    method: str
    args: list[Any]
    kwargs: dict[str, Any] = field(default_factory=dict)
    call_id: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RpcCall":
        """Deserialize from capnweb format"""
        return cls(
            method=data.get("method", ""),
            args=data.get("args", []),
            kwargs=data.get("kwargs", {}),
            call_id=data.get("callId", ""),
        )


@dataclass
class RpcResult:
    """Result of an RPC call."""
    value: Any = None
    error: str | None = None
    call_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to capnweb format"""
        result: dict[str, Any] = {"callId": self.call_id}
        if self.error:
            result["error"] = self.error
        else:
            result["value"] = self.value
        return result

    @classmethod
    def success(cls, value: Any, call_id: str = "") -> "RpcResult":
        """Create a successful result"""
        return cls(value=value, call_id=call_id)

    @classmethod
    def failure(cls, error: str, call_id: str = "") -> "RpcResult":
        """Create an error result"""
        return cls(error=error, call_id=call_id)


class RpcTarget:
    """
    Base class for RPC-enabled services.

    Extend this class and define methods that can be called via capnweb RPC.
    Methods starting with underscore are considered private and not exposed.
    """

    def _get_methods(self) -> list[str]:
        """Get list of public RPC methods"""
        return [
            name for name in dir(self)
            if not name.startswith("_")
            and callable(getattr(self, name))
        ]

    async def _invoke(self, call: RpcCall) -> RpcResult:
        """Invoke an RPC method"""
        method_name = call.method

        if method_name.startswith("_") or not hasattr(self, method_name):
            return RpcResult.failure(
                f"Method '{method_name}' not found",
                call.call_id
            )

        method = getattr(self, method_name)
        if not callable(method):
            return RpcResult.failure(
                f"'{method_name}' is not callable",
                call.call_id
            )

        try:
            result = method(*call.args, **call.kwargs)
            # Handle async methods
            if hasattr(result, "__await__"):
                result = await result
            return RpcResult.success(result, call.call_id)
        except Exception as e:
            return RpcResult.failure(str(e), call.call_id)

    def _dispose(self) -> None:
        """Clean up resources. Override in subclasses."""
        pass


# =============================================================================
# Environment and Bindings
# =============================================================================


@dataclass
class Env:
    """
    Environment bindings provided by Cloudflare Workers.
    """
    _bindings: dict[str, Any] = field(default_factory=dict)

    def get(self, name: str) -> Any:
        """Get a binding by name"""
        return self._bindings.get(name)

    def __getattr__(self, name: str) -> Any:
        """Access bindings as attributes"""
        if name.startswith("_"):
            raise AttributeError(name)
        return self._bindings.get(name)

    @classmethod
    def from_dict(cls, bindings: dict[str, Any]) -> "Env":
        """Create from dictionary"""
        return cls(_bindings=bindings)


@dataclass
class ExecutionContext:
    """Execution context for the function."""
    _wait_until_promises: list[Awaitable[Any]] = field(default_factory=list)

    def wait_until(self, promise: Awaitable[Any]) -> None:
        """Schedule a background task that continues after response is sent."""
        self._wait_until_promises.append(promise)

    def pass_through_on_exception(self) -> None:
        """Allow the request to pass through to origin on exception."""
        pass


# =============================================================================
# Handler Types
# =============================================================================


FetchHandler = Callable[[Request, Env, ExecutionContext], Union[Response, Awaitable[Response]]]
RpcHandler = Callable[[RpcCall, Env], Union[RpcResult, Awaitable[RpcResult]]]
ScheduledHandler = Callable[[dict[str, Any], Env, ExecutionContext], Awaitable[None]]


# =============================================================================
# Handler Implementation
# =============================================================================


class Handler(RpcTarget):
    """
    Handler implementation with fetch, RPC, and scheduled support.

    Override methods to customize behavior:
    - fetch: Handle HTTP requests
    - scheduled: Handle cron triggers
    """

    def __init__(self, env: Env | None = None) -> None:
        self.env = env or Env()

    async def fetch(self, request: Request, ctx: ExecutionContext) -> Response:
        """
        Handle incoming HTTP request.

        Override this method to implement your function logic.
        """
        # Check for RPC calls
        if (
            request.method == RequestMethod.POST
            and request.headers.get("content-type", "").startswith("application/json")
            and request.headers.get("x-capnweb-rpc") == "1"
        ):
            try:
                data = request.json()
                call = RpcCall.from_dict(data)
                result = await self._invoke(call)
                return Response.json(result.to_dict())
            except Exception as e:
                return Response.json(
                    RpcResult.failure(str(e)).to_dict(),
                    status=500
                )

        # Default response
        return Response.json({
            "message": "Hello from ${config.name}!",
            "path": request.path,
            "method": request.method.value,
            "timestamp": datetime.utcnow().isoformat(),
        })

    async def scheduled(self, event: dict[str, Any], ctx: ExecutionContext) -> None:
        """Handle scheduled/cron trigger."""
        pass
${exampleMethods}

# =============================================================================
# Entry Point
# =============================================================================


_handler: Handler | None = None


def get_handler() -> Handler:
    """Get or create the handler instance"""
    global _handler
    if _handler is None:
        _handler = Handler()
    return _handler


async def handler(args: dict[str, Any]) -> dict[str, Any]:
    """
    Main entry point for Functions.do.

    This function is called by the runtime with the incoming request.
    """
    h = get_handler()

    request_type = args.get("type", "fetch")

    if request_type == "fetch":
        request = Request.from_dict(args.get("request", {}))
        env = Env.from_dict(args.get("env", {}))
        ctx = ExecutionContext()
        response = await h.fetch(request, ctx)
        return response.to_dict()

    elif request_type == "rpc":
        call = RpcCall.from_dict(args.get("call", {}))
        result = await h._invoke(call)
        return result.to_dict()

    elif request_type == "scheduled":
        event = args.get("event", {})
        env = Env.from_dict(args.get("env", {}))
        ctx = ExecutionContext()
        await h.scheduled(event, ctx)
        return {"success": True}

    else:
        return {"error": f"Unknown request type: {request_type}"}


def main() -> None:
    """CLI entry point for local testing"""
    import asyncio

    async def test():
        # Test fetch
        result = await handler({
            "type": "fetch",
            "request": {
                "method": "GET",
                "url": "https://example.com/test",
                "headers": {},
            },
        })
        print("Fetch result:", json.dumps(result, indent=2))

        # Test RPC
        result = await handler({
            "type": "rpc",
            "call": {
                "method": "ping",
                "args": [],
            },
        })
        print("RPC result:", json.dumps(result, indent=2))

    asyncio.run(test())


if __name__ == "__main__":
    main()
`
}

/**
 * Generate README.md content
 */
function generateReadme(config: SdkTemplateConfig): string {
  const name = config.name
  const description = config.description || 'A serverless Python function for Functions.do'

  return `# ${name}

${description}

## Overview

This is a serverless Python function running on [Functions.do](https://functions.do) via Cloudflare Workers and Pyodide.

## Project Structure

\`\`\`
.
├── pyproject.toml          # Project configuration and dependencies
├── requirements.txt        # pip-compatible dependencies
├── README.md              # This file
├── src/
│   ├── __init__.py        # Package initialization
│   └── handler.py         # Main handler with capnweb RPC integration
└── tests/
    └── test_handler.py    # Test files
\`\`\`

## Getting Started

### Prerequisites

- Python 3.10 or later
- pip or uv for package management

### Local Development

1. **Install dependencies:**

   \`\`\`bash
   # Using pip
   pip install -e ".[dev]"

   # Using uv (faster)
   uv pip install -e ".[dev]"
   \`\`\`

2. **Run locally:**

   \`\`\`bash
   python -m src.handler
   \`\`\`

3. **Run tests:**

   \`\`\`bash
   pytest
   \`\`\`

### Deployment

Deploy to Functions.do using the CLI:

\`\`\`bash
functions deploy
\`\`\`

## Usage

### HTTP Requests

The handler responds to HTTP requests:

\`\`\`python
class Handler(RpcTarget):
    async def fetch(self, request: Request, ctx: ExecutionContext) -> Response:
        return Response.json({"message": "Hello!"})
\`\`\`

### RPC Methods

Add RPC methods that can be called from JavaScript:

\`\`\`python
class Handler(RpcTarget):
    def greet(self, name: str) -> str:
        return f"Hello, {name}!"

    async def process_data(self, data: dict) -> dict:
        result = await some_async_operation(data)
        return result
\`\`\`

### Calling from JavaScript

\`\`\`javascript
const result = await pythonWorker.greet('World');
// Returns: "Hello, World!"
\`\`\`

## License

MIT
`
}

/**
 * Generate test handler content
 */
function generateTestHandler(config: SdkTemplateConfig): string {
  return `"""
Tests for ${config.name} handler
"""

import pytest
from src.handler import handler, Handler, Request, Response, RequestMethod, Headers


@pytest.mark.asyncio
async def test_fetch_returns_200():
    """Test that fetch returns a 200 response"""
    result = await handler({
        "type": "fetch",
        "request": {
            "method": "GET",
            "url": "https://example.com/",
            "headers": {},
        },
    })

    assert result["status"] == 200


@pytest.mark.asyncio
async def test_fetch_returns_json():
    """Test that fetch returns valid JSON body"""
    result = await handler({
        "type": "fetch",
        "request": {
            "method": "GET",
            "url": "https://example.com/test",
            "headers": {},
        },
    })

    assert result["status"] == 200
    assert "body" in result


@pytest.mark.asyncio
async def test_rpc_ping():
    """Test RPC ping method"""
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "ping",
            "args": [],
        },
    })

    assert result["value"] == "pong"
    assert result.get("error") is None


@pytest.mark.asyncio
async def test_rpc_echo():
    """Test RPC echo method"""
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "echo",
            "args": ["Hello, World!"],
        },
    })

    assert result["value"] == "Hello, World!"


@pytest.mark.asyncio
async def test_rpc_add():
    """Test RPC add method"""
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "add",
            "args": [5, 3],
        },
    })

    assert result["value"] == 8


@pytest.mark.asyncio
async def test_rpc_method_not_found():
    """Test RPC returns error for unknown method"""
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "nonexistent_method",
            "args": [],
        },
    })

    assert "error" in result
    assert "not found" in result["error"]


@pytest.mark.asyncio
async def test_rpc_private_method_not_accessible():
    """Test that private methods cannot be called via RPC"""
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "_invoke",
            "args": [],
        },
    })

    assert "error" in result
    assert "not found" in result["error"]


@pytest.mark.asyncio
async def test_request_from_dict():
    """Test Request.from_dict creates valid request"""
    request = Request.from_dict({
        "method": "POST",
        "url": "https://example.com/api?foo=bar",
        "headers": {"content-type": "application/json"},
        "body": '{"key": "value"}',
    })

    assert request.method == RequestMethod.POST
    assert request.path == "/api"
    assert request.query == {"foo": "bar"}
    assert request.json() == {"key": "value"}


def test_response_json():
    """Test Response.json creates valid JSON response"""
    response = Response.json({"message": "Hello"})

    assert response.status == 200
    assert response.headers.get("content-type") == "application/json"
    assert response.body == '{"message": "Hello"}'


def test_response_text():
    """Test Response.text creates valid text response"""
    response = Response.text("Hello, World!")

    assert response.status == 200
    assert response.headers.get("content-type") == "text/plain; charset=utf-8"
    assert response.body == "Hello, World!"


def test_response_redirect():
    """Test Response.redirect creates valid redirect"""
    response = Response.redirect("https://example.com/new")

    assert response.status == 302
    assert response.headers.get("location") == "https://example.com/new"


def test_headers_case_insensitive():
    """Test that Headers access is case-insensitive"""
    headers = Headers()
    headers.set("Content-Type", "application/json")

    assert headers.get("content-type") == "application/json"
    assert headers.get("CONTENT-TYPE") == "application/json"
    assert headers.get("Content-Type") == "application/json"
`
}

/**
 * Validate a project's dependencies are Pyodide-compatible
 */
export async function validateProject(
  projectDir: string
): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    const result = await bundleDependencies(projectDir, { strict: false, verbose: true })

    // Report excluded packages as errors
    for (const excluded of result.excluded) {
      errors.push(`Incompatible package "${excluded.name}": ${excluded.reason}`)
    }

    // Include warnings
    warnings.push(...result.warnings)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  } catch (error) {
    errors.push(`Failed to validate project: ${error instanceof Error ? error.message : String(error)}`)
    return {
      valid: false,
      errors,
      warnings,
    }
  }
}
