/**
 * Memory Snapshot Configuration Tests
 *
 * Tests for memory snapshot configuration parsing, validation,
 * and code generation for faster cold starts.
 */

import { describe, it, expect } from 'vitest'
import {
  parseSnapshotConfig,
  generatePreloadList,
  generateSnapshotInitCode,
  estimateSnapshotSize,
  validateSnapshotConfig,
  generateWranglerSnapshotConfig,
  createMinimalSnapshotConfig,
  createFullSnapshotConfig,
  type SnapshotConfig,
} from '../memory-snapshot'
import type { PythonDependency } from '../dependency-parser'

describe('Memory Snapshot Configuration', () => {
  describe('parseSnapshotConfig', () => {
    it('parses enabled flag', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
`
      const result = parseSnapshotConfig(content)

      expect(result).not.toBeNull()
      expect(result?.enabled).toBe(true)
    })

    it('parses disabled flag', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = false
`
      const result = parseSnapshotConfig(content)

      expect(result?.enabled).toBe(false)
    })

    it('parses preload modules', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
preload_modules = [
    "json",
    "datetime",
    "re",
]
`
      const result = parseSnapshotConfig(content)

      expect(result?.preloadModules).toHaveLength(3)
      expect(result?.preloadModules).toContain('json')
      expect(result?.preloadModules).toContain('datetime')
      expect(result?.preloadModules).toContain('re')
    })

    it('parses preinstall packages', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
preinstall_packages = [
    "numpy",
    "pandas",
]
`
      const result = parseSnapshotConfig(content)

      expect(result?.preinstallPackages).toHaveLength(2)
      expect(result?.preinstallPackages).toContain('numpy')
      expect(result?.preinstallPackages).toContain('pandas')
    })

    it('parses max size', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
max_size = 52428800
`
      const result = parseSnapshotConfig(content)

      expect(result?.maxSize).toBe(52428800)
    })

    it('parses init code', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
init_code = """
import json
CONFIG = json.loads('{"key": "value"}')
"""
`
      const result = parseSnapshotConfig(content)

      expect(result?.initCode).toContain('import json')
      expect(result?.initCode).toContain('CONFIG')
    })

    it('returns null when section not found', () => {
      const content = `
[project]
name = "my-project"
`
      const result = parseSnapshotConfig(content)

      expect(result).toBeNull()
    })

    it('handles empty arrays', () => {
      const content = `
[tool.functions-do.snapshot]
enabled = true
preload_modules = []
`
      const result = parseSnapshotConfig(content)

      expect(result?.preloadModules).toEqual([])
    })
  })

  describe('generatePreloadList', () => {
    it('includes default preload modules', () => {
      const result = generatePreloadList([])

      expect(result.modules).toContain('json')
      expect(result.modules).toContain('datetime')
      expect(result.modules).toContain('re')
      expect(result.modules).toContain('typing')
    })

    it('adds user-specified modules', () => {
      const result = generatePreloadList([], ['custom_module'])

      expect(result.modules).toContain('custom_module')
    })

    it('warns about unsafe preload modules', () => {
      const result = generatePreloadList([], ['asyncio', 'logging'])

      expect(result.warnings.some((w) => w.includes('asyncio'))).toBe(true)
      expect(result.warnings.some((w) => w.includes('logging'))).toBe(true)
    })

    it('includes compatible dependencies', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'pydantic' },
      ]
      const result = generatePreloadList(deps)

      expect(result.modules).toContain('numpy')
      expect(result.modules).toContain('pydantic')
    })

    it('warns about unknown packages', () => {
      const deps: PythonDependency[] = [
        { name: 'some-unknown-package' },
      ]
      const result = generatePreloadList(deps)

      expect(result.warnings.some((w) => w.includes('unknown'))).toBe(true)
    })

    it('sorts modules alphabetically', () => {
      const result = generatePreloadList([], ['zlib', 'abc'])

      const sortedIndex = (arr: string[], item: string) => arr.indexOf(item)
      expect(sortedIndex(result.modules, 'abc')).toBeLessThan(
        sortedIndex(result.modules, 'zlib')
      )
    })
  })

  describe('generateSnapshotInitCode', () => {
    it('generates import statements for preload modules', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: ['json', 'datetime'],
        preinstallPackages: [],
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('import json')
      expect(result).toContain('import datetime')
    })

    it('handles submodule imports', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: ['urllib.parse'],
        preinstallPackages: [],
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('import urllib')
      expect(result).toContain('from urllib import parse')
    })

    it('generates micropip install for packages', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: ['numpy', 'pandas'],
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('import micropip')
      expect(result).toContain('await micropip.install')
      expect(result).toContain('"numpy"')
      expect(result).toContain('"pandas"')
    })

    it('includes custom init code', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
        initCode: 'MY_CONSTANT = 42',
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('MY_CONSTANT = 42')
    })

    it('initializes globals', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
        globals: {
          DEBUG: true,
          VERSION: '1.0.0',
        },
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('DEBUG = true')
      expect(result).toContain('VERSION = "1.0.0"')
    })

    it('includes garbage collection', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('import gc')
      expect(result).toContain('gc.collect()')
    })

    it('sets snapshot ready flag', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
      }
      const result = generateSnapshotInitCode(config)

      expect(result).toContain('_snapshot_ready = True')
    })
  })

  describe('estimateSnapshotSize', () => {
    it('includes Pyodide base size', () => {
      const result = estimateSnapshotSize([])

      expect(result.breakdown['pyodide_base']).toBeGreaterThan(0)
      expect(result.estimatedBytes).toBeGreaterThan(0)
    })

    it('estimates size for known modules', () => {
      const result = estimateSnapshotSize(['numpy', 'pandas'])

      expect(result.breakdown['numpy']).toBeGreaterThan(0)
      expect(result.breakdown['pandas']).toBeGreaterThan(0)
      expect(result.estimatedBytes).toBeGreaterThan(
        estimateSnapshotSize([]).estimatedBytes
      )
    })

    it('provides default size for unknown modules', () => {
      const result = estimateSnapshotSize(['unknown_module'])

      expect(result.breakdown['unknown_module']).toBeGreaterThan(0)
    })

    it('returns size in bytes', () => {
      const result = estimateSnapshotSize(['json'])

      expect(result.estimatedBytes).toBeGreaterThan(1000)
      expect(result.breakdown['json']).toBeGreaterThan(1000)
    })
  })

  describe('validateSnapshotConfig', () => {
    it('validates valid configuration', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: ['json', 'datetime'],
        preinstallPackages: ['pydantic'],
      }
      const result = validateSnapshotConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('warns about unsafe preload modules', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: ['asyncio', 'threading'],
        preinstallPackages: [],
      }
      const result = validateSnapshotConfig(config)

      expect(result.warnings.some((w) => w.includes('asyncio'))).toBe(true)
      expect(result.warnings.some((w) => w.includes('threading'))).toBe(true)
    })

    it('errors on incompatible packages', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: ['psycopg2', 'tensorflow'],
      }
      const result = validateSnapshotConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('psycopg2'))).toBe(true)
      expect(result.errors.some((e) => e.includes('tensorflow'))).toBe(true)
    })

    it('errors when estimated size exceeds max', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: ['numpy', 'pandas', 'scipy', 'scikit-learn', 'matplotlib'],
        maxSize: 1024, // Very small max size
      }
      const result = validateSnapshotConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('exceeds'))).toBe(true)
    })

    it('warns when close to max size', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: ['numpy'],
        maxSize: 15 * 1024 * 1024, // Slightly above numpy estimated size
      }
      const result = validateSnapshotConfig(config)

      // Should warn about being close to max
      expect(result.warnings.some((w) => w.includes('close'))).toBe(true)
    })

    it('warns about file operations in init code', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
        initCode: 'with open("file.txt") as f: data = f.read()',
      }
      const result = validateSnapshotConfig(config)

      expect(result.warnings.some((w) => w.includes('file operations'))).toBe(true)
    })

    it('errors on socket operations in init code', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
        initCode: 'import socket; s = socket.socket()',
      }
      const result = validateSnapshotConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('socket'))).toBe(true)
    })
  })

  describe('generateWranglerSnapshotConfig', () => {
    it('generates empty string when disabled', () => {
      const config: SnapshotConfig = {
        enabled: false,
        preloadModules: [],
        preinstallPackages: [],
      }
      const result = generateWranglerSnapshotConfig(config)

      expect(result).toBe('')
    })

    it('generates enabled config', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: [],
      }
      const result = generateWranglerSnapshotConfig(config)

      expect(result).toContain('[python.snapshot]')
      expect(result).toContain('enabled = true')
    })

    it('includes preload modules', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: ['json', 'datetime'],
        preinstallPackages: [],
      }
      const result = generateWranglerSnapshotConfig(config)

      expect(result).toContain('preload_modules')
      expect(result).toContain('"json"')
      expect(result).toContain('"datetime"')
    })

    it('includes preinstall packages', () => {
      const config: SnapshotConfig = {
        enabled: true,
        preloadModules: [],
        preinstallPackages: ['numpy', 'pandas'],
      }
      const result = generateWranglerSnapshotConfig(config)

      expect(result).toContain('preinstall_packages')
      expect(result).toContain('"numpy"')
      expect(result).toContain('"pandas"')
    })
  })

  describe('createMinimalSnapshotConfig', () => {
    it('returns enabled config', () => {
      const config = createMinimalSnapshotConfig()

      expect(config.enabled).toBe(true)
    })

    it('includes essential preload modules', () => {
      const config = createMinimalSnapshotConfig()

      expect(config.preloadModules).toContain('json')
      expect(config.preloadModules).toContain('datetime')
      expect(config.preloadModules).toContain('re')
      expect(config.preloadModules).toContain('typing')
    })

    it('has empty preinstall packages', () => {
      const config = createMinimalSnapshotConfig()

      expect(config.preinstallPackages).toHaveLength(0)
    })
  })

  describe('createFullSnapshotConfig', () => {
    it('includes compatible dependencies', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'pydantic' },
      ]
      const result = createFullSnapshotConfig(deps)

      expect(result.config.preinstallPackages).toContain('numpy')
      expect(result.config.preinstallPackages).toContain('pydantic')
    })

    it('excludes incompatible dependencies', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'psycopg2' },
      ]
      const result = createFullSnapshotConfig(deps)

      expect(result.config.preinstallPackages).toContain('numpy')
      expect(result.config.preinstallPackages).not.toContain('psycopg2')
    })

    it('includes preload modules', () => {
      const deps: PythonDependency[] = []
      const result = createFullSnapshotConfig(deps)

      expect(result.config.preloadModules.length).toBeGreaterThan(0)
    })

    it('returns warnings for unknown packages', () => {
      const deps: PythonDependency[] = [
        { name: 'unknown-package' },
      ]
      const result = createFullSnapshotConfig(deps)

      expect(result.warnings.some((w) => w.includes('unknown'))).toBe(true)
    })
  })
})
