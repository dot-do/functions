/**
 * Python Dependency Parser Tests
 *
 * Tests for parsing requirements.txt and pyproject.toml files
 * to extract Python package dependencies for bundling.
 */

import { describe, it, expect } from 'vitest'
import {
  parseRequirementsTxt,
  parsePyprojectToml,
  normalizePackageName,
  generateRequirementsTxt,
  parseDependenciesFromDir,
  type PythonDependency,
  type DependencyParseResult,
} from '../dependency-parser'

describe('Python Dependency Parser', () => {
  describe('normalizePackageName', () => {
    it('lowercases package names', () => {
      expect(normalizePackageName('Requests')).toBe('requests')
      expect(normalizePackageName('NumPy')).toBe('numpy')
    })

    it('replaces underscores with hyphens', () => {
      expect(normalizePackageName('typing_extensions')).toBe('typing-extensions')
      expect(normalizePackageName('python_dateutil')).toBe('python-dateutil')
    })

    it('replaces dots with hyphens', () => {
      expect(normalizePackageName('ruamel.yaml')).toBe('ruamel-yaml')
    })

    it('handles mixed cases', () => {
      expect(normalizePackageName('Flask_RESTful')).toBe('flask-restful')
    })
  })

  describe('parseRequirementsTxt', () => {
    it('parses basic package names', () => {
      const content = `
requests
flask
numpy
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(3)
      expect(result.dependencies[0].name).toBe('requests')
      expect(result.dependencies[1].name).toBe('flask')
      expect(result.dependencies[2].name).toBe('numpy')
    })

    it('parses version specifiers', () => {
      const content = `
requests>=2.0.0
flask==2.0.1
numpy~=1.24.0
pandas<2.0.0
scipy!=1.5.0
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(5)
      expect(result.dependencies[0].versionSpec).toBe('>=2.0.0')
      expect(result.dependencies[1].versionSpec).toBe('==2.0.1')
      expect(result.dependencies[2].versionSpec).toBe('~=1.24.0')
      expect(result.dependencies[3].versionSpec).toBe('<2.0.0')
      expect(result.dependencies[4].versionSpec).toBe('!=1.5.0')
    })

    it('parses extras', () => {
      const content = `
requests[security]
sqlalchemy[postgresql,mysql]
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies[0].extras).toEqual(['security'])
      expect(result.dependencies[1].extras).toEqual(['postgresql', 'mysql'])
    })

    it('parses environment markers', () => {
      const content = `
pywin32; sys_platform == 'win32'
uvloop; platform_system != 'Windows'
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies[0].markers).toBe("sys_platform == 'win32'")
      expect(result.dependencies[1].markers).toBe("platform_system != 'Windows'")
    })

    it('ignores comments', () => {
      const content = `
# This is a comment
requests  # inline comment
# Another comment
flask
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(2)
      expect(result.dependencies[0].name).toBe('requests')
      expect(result.dependencies[1].name).toBe('flask')
    })

    it('ignores empty lines', () => {
      const content = `

requests

flask

`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(2)
    })

    it('handles line continuations', () => {
      const content = `requests\\
>=2.0.0`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(1)
      expect(result.dependencies[0].name).toBe('requests')
      expect(result.dependencies[0].versionSpec).toBe('>=2.0.0')
    })

    it('warns about include directives', () => {
      const content = `
requests
-r base.txt
flask
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(2)
      expect(result.warnings).toBeDefined()
      expect(result.warnings?.some((w) => w.includes('-r'))).toBe(true)
    })

    it('warns about editable installs', () => {
      const content = `
-e git+https://github.com/user/repo.git
requests
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(1)
      expect(result.warnings?.some((w) => w.includes('Editable'))).toBe(true)
    })

    it('warns about URL-based dependencies', () => {
      const content = `
https://example.com/package.whl
git+https://github.com/user/repo.git
requests
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(1)
      expect(result.warnings).toHaveLength(2)
    })

    it('parses complex requirements', () => {
      const content = `
requests[security,socks]>=2.20.0,<3.0.0; python_version >= '3.7'
`
      const result = parseRequirementsTxt(content)

      expect(result.dependencies).toHaveLength(1)
      const dep = result.dependencies[0]
      expect(dep.name).toBe('requests')
      expect(dep.extras).toEqual(['security', 'socks'])
      expect(dep.versionSpec).toContain('>=2.20.0')
      expect(dep.markers).toContain("python_version >= '3.7'")
    })
  })

  describe('parsePyprojectToml', () => {
    it('parses PEP 621 dependencies', () => {
      const content = `
[project]
name = "my-project"
dependencies = [
    "requests>=2.0.0",
    "flask",
]
`
      const result = parsePyprojectToml(content)

      expect(result.projectName).toBe('my-project')
      expect(result.dependencies).toHaveLength(2)
      expect(result.dependencies[0].name).toBe('requests')
      expect(result.dependencies[0].versionSpec).toBe('>=2.0.0')
      expect(result.dependencies[1].name).toBe('flask')
    })

    it('parses Python version requirement', () => {
      const content = `
[project]
name = "my-project"
requires-python = ">=3.10"
dependencies = []
`
      const result = parsePyprojectToml(content)

      expect(result.pythonVersion).toBe('>=3.10')
    })

    it('parses optional dependencies', () => {
      const content = `
[project]
name = "my-project"
dependencies = []

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "mypy",
]
test = [
    "coverage",
]
`
      const result = parsePyprojectToml(content)

      expect(result.dependencies).toHaveLength(3)
      const devDeps = result.dependencies.filter((d) => d.isDev)
      expect(devDeps).toHaveLength(2)
    })

    it('parses Poetry style dependencies', () => {
      const content = `
[tool.poetry]
name = "my-project"

[tool.poetry.dependencies]
python = "^3.10"
requests = "^2.28.0"
flask = ">=2.0.0"
`
      const result = parsePyprojectToml(content)

      expect(result.projectName).toBe('my-project')
      expect(result.pythonVersion).toBe('^3.10')
      expect(result.dependencies).toHaveLength(2)
    })

    it('converts Poetry caret version specs', () => {
      const content = `
[tool.poetry.dependencies]
requests = "^2.28.0"
`
      const result = parsePyprojectToml(content)

      const dep = result.dependencies[0]
      expect(dep.versionSpec).toContain('>=2.28.0')
      expect(dep.versionSpec).toContain('<3.0.0')
    })

    it('parses entry points', () => {
      const content = `
[project]
name = "my-project"
dependencies = []

[project.scripts]
my-cli = "my_project:main"

[project.entry-points."functions.do"]
handler = "my_project:handler"
`
      const result = parsePyprojectToml(content)

      expect(result.entryPoints).toBeDefined()
      expect(result.entryPoints?.['my-cli']).toBe('my_project:main')
    })

    it('parses Poetry dev dependencies', () => {
      const content = `
[tool.poetry.dev-dependencies]
pytest = "^7.0.0"
mypy = "^1.0.0"
`
      const result = parsePyprojectToml(content)

      expect(result.dependencies).toHaveLength(2)
      expect(result.dependencies.every((d) => d.isDev)).toBe(true)
    })

    it('handles inline tables for extras', () => {
      const content = `
[tool.poetry.dependencies]
sqlalchemy = {version = "^2.0.0", extras = ["postgresql"]}
`
      const result = parsePyprojectToml(content)

      expect(result.dependencies).toHaveLength(1)
      expect(result.dependencies[0].extras).toContain('postgresql')
    })
  })

  describe('generateRequirementsTxt', () => {
    it('generates basic requirements', () => {
      const deps: PythonDependency[] = [
        { name: 'requests' },
        { name: 'flask' },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toContain('requests')
      expect(result).toContain('flask')
    })

    it('includes version specifiers', () => {
      const deps: PythonDependency[] = [
        { name: 'requests', versionSpec: '>=2.0.0' },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toBe('requests>=2.0.0')
    })

    it('includes extras', () => {
      const deps: PythonDependency[] = [
        { name: 'requests', extras: ['security'] },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toBe('requests[security]')
    })

    it('includes markers', () => {
      const deps: PythonDependency[] = [
        { name: 'pywin32', markers: "sys_platform == 'win32'" },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toBe("pywin32; sys_platform == 'win32'")
    })

    it('excludes dev dependencies by default', () => {
      const deps: PythonDependency[] = [
        { name: 'requests' },
        { name: 'pytest', isDev: true },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toBe('requests')
    })

    it('includes dev dependencies when specified', () => {
      const deps: PythonDependency[] = [
        { name: 'requests' },
        { name: 'pytest', isDev: true },
      ]
      const result = generateRequirementsTxt(deps, true)

      expect(result).toContain('requests')
      expect(result).toContain('pytest')
    })

    it('generates complete requirement lines', () => {
      const deps: PythonDependency[] = [
        {
          name: 'requests',
          versionSpec: '>=2.0.0',
          extras: ['security'],
          markers: "python_version >= '3.8'",
        },
      ]
      const result = generateRequirementsTxt(deps)

      expect(result).toBe("requests[security]>=2.0.0; python_version >= '3.8'")
    })
  })

  describe('Integration', () => {
    it('round-trips through generation and parsing', () => {
      const original: PythonDependency[] = [
        { name: 'requests', versionSpec: '>=2.0.0' },
        { name: 'flask', versionSpec: '==2.0.1' },
        { name: 'numpy' },
      ]

      const generated = generateRequirementsTxt(original)
      const parsed = parseRequirementsTxt(generated)

      expect(parsed.dependencies).toHaveLength(3)
      expect(parsed.dependencies[0].name).toBe('requests')
      expect(parsed.dependencies[0].versionSpec).toBe('>=2.0.0')
    })
  })
})
