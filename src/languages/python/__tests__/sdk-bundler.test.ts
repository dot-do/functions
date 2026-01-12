/**
 * Python SDK Bundler Tests
 *
 * Tests for bundling Python dependencies and generating SDK scaffolding
 * for Functions.do serverless functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  bundleDependencies,
  parseAndValidateRequirements,
  parseAndValidatePyproject,
  generateSdkScaffolding,
  validateProject,
  type BundleResult,
  type SdkTemplateConfig,
  type PackageManifest,
} from '../sdk-bundler'

describe('Python SDK Bundler', () => {
  let tempDir: string

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'functions-do-test-'))
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('bundleDependencies', () => {
    it('bundles compatible dependencies from requirements.txt', async () => {
      // Create a test requirements.txt
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
pandas>=2.0.0
pydantic>=2.0.0
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.dependencies.length).toBeGreaterThan(0)
      expect(result.dependencies.map((d) => d.name)).toContain('numpy')
      expect(result.dependencies.map((d) => d.name)).toContain('pandas')
      expect(result.dependencies.map((d) => d.name)).toContain('pydantic')
    })

    it('excludes incompatible packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
psycopg2>=2.9.0
tensorflow>=2.0.0
`
      )

      const result = await bundleDependencies(tempDir)

      // numpy should be included
      expect(result.dependencies.map((d) => d.name)).toContain('numpy')

      // psycopg2 and tensorflow should be excluded
      expect(result.excluded.map((e) => e.name)).toContain('psycopg2')
      expect(result.excluded.map((e) => e.name)).toContain('tensorflow')
    })

    it('generates valid requirements.txt output', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
requests>=2.28.0
numpy>=1.24.0
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.requirementsTxt).toContain('requests')
      expect(result.requirementsTxt).toContain('numpy')
    })

    it('builds package manifest', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
pydantic>=2.0.0
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.manifest.packages).toContain('numpy')
      expect(result.manifest.packages).toContain('pydantic')
      // Should include common stdlib modules
      expect(result.manifest.stdlib).toContain('json')
      expect(result.manifest.stdlib).toContain('datetime')
    })

    it('throws in strict mode with incompatible packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
boto3>=1.26.0
`
      )

      await expect(
        bundleDependencies(tempDir, { strict: true })
      ).rejects.toThrow('Incompatible packages found')
    })

    it('excludes dev dependencies when requested', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[project]
name = "test-project"
dependencies = ["numpy>=1.24.0"]

[project.optional-dependencies]
dev = ["pytest>=7.0.0"]
`
      )

      const result = await bundleDependencies(tempDir, { excludeDevDeps: true })

      expect(result.dependencies.map((d) => d.name)).toContain('numpy')
      expect(result.dependencies.map((d) => d.name)).not.toContain('pytest')
    })

    it('handles empty requirements.txt', async () => {
      await fs.writeFile(path.join(tempDir, 'requirements.txt'), '# No dependencies\n')

      const result = await bundleDependencies(tempDir)

      expect(result.dependencies).toHaveLength(0)
      expect(result.requirementsTxt).toBe('')
    })

    it('handles missing dependency files gracefully', async () => {
      // Empty directory - no requirements.txt or pyproject.toml
      const result = await bundleDependencies(tempDir)

      expect(result.dependencies).toHaveLength(0)
    })

    it('merges dependencies from both requirements.txt and pyproject.toml', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        'numpy>=1.24.0\n'
      )
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[project]
name = "test"
dependencies = ["pandas>=2.0.0"]
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.dependencies.map((d) => d.name)).toContain('numpy')
      expect(result.dependencies.map((d) => d.name)).toContain('pandas')
    })

    it('collects warnings from parsing', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
-r other-requirements.txt
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.includes('-r'))).toBe(true)
    })

    it('extracts Python version from pyproject.toml', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[project]
name = "test"
requires-python = ">=3.10"
dependencies = []
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.compatibility.pythonVersion?.required).toBe('>=3.10')
    })
  })

  describe('parseAndValidateRequirements', () => {
    it('parses requirements.txt and checks compatibility', async () => {
      const reqPath = path.join(tempDir, 'requirements.txt')
      await fs.writeFile(
        reqPath,
        `
numpy>=1.24.0
requests>=2.28.0
`
      )

      const result = await parseAndValidateRequirements(reqPath)

      expect(result.dependencies).toHaveLength(2)
      expect(result.compatibility.compatiblePackages).toContain('numpy')
      expect(result.compatibility.compatiblePackages).toContain('requests')
    })

    it('reports incompatible packages', async () => {
      const reqPath = path.join(tempDir, 'requirements.txt')
      await fs.writeFile(
        reqPath,
        `
numpy>=1.24.0
psycopg2>=2.9.0
`
      )

      const result = await parseAndValidateRequirements(reqPath)

      expect(result.compatibility.compatible).toBe(false)
      expect(result.compatibility.incompatiblePackages.map((p) => p.name)).toContain('psycopg2')
    })
  })

  describe('parseAndValidatePyproject', () => {
    it('parses pyproject.toml and checks compatibility', async () => {
      const pyprojectPath = path.join(tempDir, 'pyproject.toml')
      await fs.writeFile(
        pyprojectPath,
        `
[project]
name = "my-project"
requires-python = ">=3.10"
dependencies = [
    "numpy>=1.24.0",
    "pydantic>=2.0.0",
]
`
      )

      const result = await parseAndValidatePyproject(pyprojectPath)

      expect(result.result.projectName).toBe('my-project')
      expect(result.result.pythonVersion).toBe('>=3.10')
      expect(result.compatibility.compatiblePackages).toContain('numpy')
      expect(result.compatibility.compatiblePackages).toContain('pydantic')
    })

    it('extracts entry points', async () => {
      const pyprojectPath = path.join(tempDir, 'pyproject.toml')
      await fs.writeFile(
        pyprojectPath,
        `
[project]
name = "my-project"
dependencies = []

[project.scripts]
my-cli = "my_project:main"

[project.entry-points."functions.do"]
handler = "my_project:handler"
`
      )

      const result = await parseAndValidatePyproject(pyprojectPath)

      expect(result.result.entryPoints?.['my-cli']).toBe('my_project:main')
    })
  })

  describe('generateSdkScaffolding', () => {
    it('creates all required files', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        description: 'A test function',
      })

      // Check all files exist
      const files = await fs.readdir(projectDir)
      expect(files).toContain('pyproject.toml')
      expect(files).toContain('requirements.txt')
      expect(files).toContain('README.md')
      expect(files).toContain('src')
      expect(files).toContain('tests')

      const srcFiles = await fs.readdir(path.join(projectDir, 'src'))
      expect(srcFiles).toContain('__init__.py')
      expect(srcFiles).toContain('handler.py')

      const testFiles = await fs.readdir(path.join(projectDir, 'tests'))
      expect(testFiles).toContain('test_handler.py')
    })

    it('generates valid pyproject.toml', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        description: 'A test function',
      })

      const content = await fs.readFile(path.join(projectDir, 'pyproject.toml'), 'utf-8')

      expect(content).toContain('[project]')
      expect(content).toContain('name = "my-function"')
      expect(content).toContain('[tool.functions-do]')
      expect(content).toContain('handler = "src.handler:handler"')
    })

    it('includes initial dependencies', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        dependencies: ['numpy>=1.24.0', 'pandas>=2.0.0'],
      })

      const content = await fs.readFile(path.join(projectDir, 'pyproject.toml'), 'utf-8')

      expect(content).toContain('numpy>=1.24.0')
      expect(content).toContain('pandas>=2.0.0')
    })

    it('configures memory snapshots', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        enableSnapshots: true,
        preloadModules: ['json', 'datetime', 'collections'],
      })

      const content = await fs.readFile(path.join(projectDir, 'pyproject.toml'), 'utf-8')

      expect(content).toContain('[tool.functions-do.snapshot]')
      expect(content).toContain('enabled = true')
      expect(content).toContain('"json"')
      expect(content).toContain('"datetime"')
      expect(content).toContain('"collections"')
    })

    it('includes example RPC methods when requested', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        includeExamples: true,
      })

      const content = await fs.readFile(path.join(projectDir, 'src', 'handler.py'), 'utf-8')

      expect(content).toContain('def ping(self)')
      expect(content).toContain('def echo(self')
      expect(content).toContain('def add(self')
      expect(content).toContain('def info(self')
    })

    it('excludes example methods when not requested', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
        includeExamples: false,
      })

      const content = await fs.readFile(path.join(projectDir, 'src', 'handler.py'), 'utf-8')

      // The handler class should exist but without example methods
      expect(content).toContain('class Handler(RpcTarget)')
      expect(content).not.toContain('Example RPC methods')
    })

    it('generates README with project info', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-awesome-function',
        description: 'An awesome serverless function',
      })

      const content = await fs.readFile(path.join(projectDir, 'README.md'), 'utf-8')

      expect(content).toContain('# my-awesome-function')
      expect(content).toContain('An awesome serverless function')
    })

    it('generates test file', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'my-function',
      })

      const content = await fs.readFile(path.join(projectDir, 'tests', 'test_handler.py'), 'utf-8')

      expect(content).toContain('import pytest')
      expect(content).toContain('async def test_fetch_returns_200')
      expect(content).toContain('async def test_rpc_ping')
    })

    it('normalizes project name in pyproject.toml', async () => {
      const projectDir = path.join(tempDir, 'new-project')

      await generateSdkScaffolding(projectDir, {
        name: 'My_Awesome_Function',
      })

      const content = await fs.readFile(path.join(projectDir, 'pyproject.toml'), 'utf-8')

      // Name should be normalized (lowercase, hyphens)
      expect(content).toContain('name = "my-awesome-function"')
    })
  })

  describe('validateProject', () => {
    it('validates a compatible project', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
pandas>=2.0.0
`
      )

      const result = await validateProject(tempDir)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('reports errors for incompatible packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
psycopg2>=2.9.0
boto3>=1.26.0
`
      )

      const result = await validateProject(tempDir)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.includes('psycopg2'))).toBe(true)
      expect(result.errors.some((e) => e.includes('boto3'))).toBe(true)
    })

    it('includes warnings for unknown packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
numpy>=1.24.0
my-custom-pure-python-lib>=1.0.0
`
      )

      const result = await validateProject(tempDir)

      // Project is still valid (unknown packages may work)
      expect(result.valid).toBe(true)
      // But should have warnings about unknown packages
      expect(result.warnings.some((w) => w.includes('my-custom-pure-python-lib'))).toBe(true)
    })

    it('handles validation errors gracefully', async () => {
      // Create a broken pyproject.toml
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        'this is not valid toml {{{'
      )

      const result = await validateProject(tempDir)

      // Should handle the error gracefully
      expect(result.warnings.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('PackageManifest', () => {
    it('includes standard library modules for common packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
httpx>=0.24.0
pydantic>=2.0.0
python-dateutil>=2.8.0
`
      )

      const result = await bundleDependencies(tempDir)

      // Should infer needed stdlib modules from package types
      expect(result.manifest.stdlib).toContain('json')
      expect(result.manifest.stdlib).toContain('datetime')
      expect(result.manifest.stdlib).toContain('urllib')
    })

    it('extracts entry point from pyproject.toml', async () => {
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[project]
name = "my-project"
dependencies = []

[project.scripts]
handler = "my_project.handler:main"
`
      )

      const result = await bundleDependencies(tempDir)

      expect(result.manifest.entryPoint).toBe('my_project.handler:main')
    })
  })

  describe('Integration scenarios', () => {
    it('handles a complete project setup', async () => {
      // Simulate a real project structure
      await fs.writeFile(
        path.join(tempDir, 'pyproject.toml'),
        `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-data-processor"
version = "1.0.0"
description = "A data processing function"
requires-python = ">=3.10"
dependencies = [
    "numpy>=1.24.0",
    "pandas>=2.0.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "mypy>=1.0.0",
]

[project.scripts]
handler = "src.handler:handler"

[tool.functions-do]
runtime = "python"
handler = "src.handler:handler"

[tool.functions-do.snapshot]
enabled = true
preload_modules = ["json", "datetime", "re"]
`
      )

      const result = await bundleDependencies(tempDir, { excludeDevDeps: true })

      // Core dependencies should be included
      expect(result.dependencies.map((d) => d.name)).toContain('numpy')
      expect(result.dependencies.map((d) => d.name)).toContain('pandas')
      expect(result.dependencies.map((d) => d.name)).toContain('pydantic')

      // Dev dependencies should be excluded
      expect(result.dependencies.map((d) => d.name)).not.toContain('pytest')
      expect(result.dependencies.map((d) => d.name)).not.toContain('mypy')

      // Entry point should be extracted
      expect(result.manifest.entryPoint).toBe('src.handler:handler')

      // Should be compatible
      expect(result.compatibility.compatible).toBe(true)
    })

    it('handles ML project with unsupported packages', async () => {
      await fs.writeFile(
        path.join(tempDir, 'requirements.txt'),
        `
# Supported
numpy>=1.24.0
pandas>=2.0.0
scikit-learn>=1.3.0

# Not supported - needs Workers AI
tensorflow>=2.0.0
torch>=2.0.0

# Not supported - needs database driver
psycopg2>=2.9.0
`
      )

      const result = await bundleDependencies(tempDir)

      // Supported packages
      expect(result.dependencies.map((d) => d.name)).toContain('numpy')
      expect(result.dependencies.map((d) => d.name)).toContain('pandas')
      expect(result.dependencies.map((d) => d.name)).toContain('scikit-learn')

      // Excluded packages with suggestions
      const tensorflow = result.excluded.find((e) => e.name === 'tensorflow')
      expect(tensorflow).toBeDefined()
      expect(tensorflow?.suggestion).toBeDefined()
      expect(tensorflow!.suggestion).toContain('Workers AI')

      const psycopg2 = result.excluded.find((e) => e.name === 'psycopg2')
      expect(psycopg2).toBeDefined()
      expect(psycopg2?.suggestion).toBeDefined()
      expect(psycopg2!.suggestion).toContain('Hyperdrive')
    })
  })
})
