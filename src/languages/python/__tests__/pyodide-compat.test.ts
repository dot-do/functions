/**
 * Pyodide Compatibility Checker Tests
 *
 * Tests for checking Python package and code compatibility
 * with Pyodide (Python in WebAssembly on Cloudflare Workers).
 */

import { describe, it, expect } from 'vitest'
import {
  checkPyodideCompat,
  checkCodeCompat,
  filterCompatibleDependencies,
  getKnownCompatiblePackages,
  isPackageCompatible,
  type PyodideCompatResult,
} from '../pyodide-compat'
import type { PythonDependency } from '../dependency-parser'

describe('Pyodide Compatibility Checker', () => {
  describe('isPackageCompatible', () => {
    it('returns compatible for standard library modules', () => {
      expect(isPackageCompatible('json')).toBe('compatible')
      expect(isPackageCompatible('datetime')).toBe('compatible')
      expect(isPackageCompatible('re')).toBe('compatible')
      expect(isPackageCompatible('collections')).toBe('compatible')
    })

    it('returns compatible for Pyodide-loadable packages', () => {
      expect(isPackageCompatible('numpy')).toBe('compatible')
      expect(isPackageCompatible('pandas')).toBe('compatible')
      expect(isPackageCompatible('scipy')).toBe('compatible')
      expect(isPackageCompatible('pydantic')).toBe('compatible')
    })

    it('returns incompatible for known incompatible packages', () => {
      expect(isPackageCompatible('psycopg2')).toBe('incompatible')
      expect(isPackageCompatible('tensorflow')).toBe('incompatible')
      expect(isPackageCompatible('django')).toBe('incompatible')
      expect(isPackageCompatible('boto3')).toBe('incompatible')
    })

    it('returns unknown for unrecognized packages', () => {
      expect(isPackageCompatible('some-random-package')).toBe('unknown')
      expect(isPackageCompatible('my-custom-lib')).toBe('unknown')
    })

    it('handles case-insensitive package names', () => {
      expect(isPackageCompatible('NumPy')).toBe('compatible')
      expect(isPackageCompatible('PANDAS')).toBe('compatible')
    })
  })

  describe('checkPyodideCompat', () => {
    it('returns compatible for all compatible packages', () => {
      const deps: PythonDependency[] = [
        { name: 'json' },
        { name: 'numpy' },
        { name: 'pydantic' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(true)
      expect(result.compatiblePackages).toHaveLength(3)
      expect(result.incompatiblePackages).toHaveLength(0)
    })

    it('returns incompatible when any package is incompatible', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'psycopg2' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(false)
      expect(result.incompatiblePackages).toHaveLength(1)
      expect(result.incompatiblePackages[0].name).toBe('psycopg2')
    })

    it('provides reasons for incompatibility', () => {
      const deps: PythonDependency[] = [
        { name: 'psycopg2' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.incompatiblePackages[0].reason).toBeDefined()
      expect(result.incompatiblePackages[0].reason.length).toBeGreaterThan(0)
    })

    it('provides suggestions for incompatible packages', () => {
      const deps: PythonDependency[] = [
        { name: 'psycopg2' },
        { name: 'tensorflow' },
      ]
      const result = checkPyodideCompat(deps)

      // psycopg2 should suggest Hyperdrive or REST APIs
      const psycopg2 = result.incompatiblePackages.find((p) => p.name === 'psycopg2')
      expect(psycopg2?.suggestion).toBeDefined()

      // tensorflow should suggest Workers AI
      const tensorflow = result.incompatiblePackages.find((p) => p.name === 'tensorflow')
      expect(tensorflow?.suggestion).toContain('Workers AI')
    })

    it('tracks unknown packages', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'unknown-package' },
        { name: 'another-unknown' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.unknownPackages).toHaveLength(2)
      expect(result.unknownPackages).toContain('unknown-package')
      expect(result.unknownPackages).toContain('another-unknown')
    })

    it('warns about unknown packages', () => {
      const deps: PythonDependency[] = [
        { name: 'unknown-package' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.warnings.some((w) => w.includes('unknown-package'))).toBe(true)
      expect(result.warnings.some((w) => w.includes('pure Python'))).toBe(true)
    })

    it('checks Python version compatibility', () => {
      const deps: PythonDependency[] = []

      // Compatible version
      const result1 = checkPyodideCompat(deps, '>=3.10')
      expect(result1.pythonVersion?.compatible).toBe(true)

      // Incompatible version (too new)
      const result2 = checkPyodideCompat(deps, '<3.10')
      expect(result2.pythonVersion?.compatible).toBe(false)
    })

    it('returns Pyodide Python version', () => {
      const deps: PythonDependency[] = []
      const result = checkPyodideCompat(deps)

      expect(result.pythonVersion?.pyodideVersion).toBeDefined()
      expect(result.pythonVersion?.pyodideVersion).toMatch(/3\.\d+/)
    })

    it('detects packages matching incompatible patterns', () => {
      const deps: PythonDependency[] = [
        { name: 'python-dev' },
        { name: 'libfoo-native' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(false)
      expect(result.incompatiblePackages.length).toBeGreaterThan(0)
    })
  })

  describe('checkCodeCompat', () => {
    it('passes for compatible code', () => {
      const code = `
import json
import datetime

def handler(args):
    return json.dumps({"time": str(datetime.datetime.now())})
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(true)
      expect(result.warnings).toHaveLength(0)
    })

    it('warns about file system operations', () => {
      const code = `
with open("file.txt") as f:
    data = f.read()
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('File system'))).toBe(true)
    })

    it('allows file operations with marker comment', () => {
      const code = `
# fs-ok
with open("file.txt") as f:
    data = f.read()
`
      const result = checkCodeCompat(code)

      expect(result.warnings.every((w) => !w.includes('File system'))).toBe(true)
    })

    it('warns about subprocess usage', () => {
      const code = `
import subprocess
result = subprocess.run(["ls", "-la"])
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('subprocess'))).toBe(true)
    })

    it('warns about multiprocessing', () => {
      const code = `
import multiprocessing
pool = multiprocessing.Pool(4)
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('multiprocessing'))).toBe(true)
    })

    it('warns about threading', () => {
      const code = `
import threading
t = threading.Thread(target=worker)
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('Threading'))).toBe(true)
    })

    it('warns about socket usage', () => {
      const code = `
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('socket'))).toBe(true)
    })

    it('warns about os.system and os.popen', () => {
      const code = `
import os
os.system("ls")
os.popen("cat file.txt")
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('os.system'))).toBe(true)
    })

    it('warns about ctypes and cffi', () => {
      const code = `
import ctypes
import cffi
`
      const result = checkCodeCompat(code)

      expect(result.compatible).toBe(false)
      expect(result.warnings.some((w) => w.includes('ctypes'))).toBe(true)
    })
  })

  describe('filterCompatibleDependencies', () => {
    it('separates compatible and incompatible packages', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'psycopg2' },
        { name: 'pandas' },
        { name: 'boto3' },
      ]
      const result = filterCompatibleDependencies(deps)

      expect(result.compatible).toHaveLength(2)
      expect(result.compatible.map((d) => d.name)).toContain('numpy')
      expect(result.compatible.map((d) => d.name)).toContain('pandas')

      expect(result.filtered).toHaveLength(2)
      expect(result.filtered.map((f) => f.dependency.name)).toContain('psycopg2')
      expect(result.filtered.map((f) => f.dependency.name)).toContain('boto3')
    })

    it('includes reason for filtered packages', () => {
      const deps: PythonDependency[] = [
        { name: 'psycopg2' },
      ]
      const result = filterCompatibleDependencies(deps)

      expect(result.filtered[0].reason).toBeDefined()
      expect(result.filtered[0].reason.length).toBeGreaterThan(0)
    })

    it('keeps unknown packages in compatible list', () => {
      const deps: PythonDependency[] = [
        { name: 'unknown-package' },
      ]
      const result = filterCompatibleDependencies(deps)

      expect(result.compatible).toHaveLength(1)
      expect(result.filtered).toHaveLength(0)
    })

    it('preserves version specs and extras', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy', versionSpec: '>=1.20.0', extras: ['testing'] },
      ]
      const result = filterCompatibleDependencies(deps)

      expect(result.compatible[0].versionSpec).toBe('>=1.20.0')
      expect(result.compatible[0].extras).toEqual(['testing'])
    })
  })

  describe('getKnownCompatiblePackages', () => {
    it('returns sorted list of packages', () => {
      const packages = getKnownCompatiblePackages()

      const sorted = [...packages].sort()
      expect(packages).toEqual(sorted)
    })

    it('includes standard library modules', () => {
      const packages = getKnownCompatiblePackages()

      expect(packages).toContain('json')
      expect(packages).toContain('datetime')
      expect(packages).toContain('re')
    })

    it('includes Pyodide-loadable packages', () => {
      const packages = getKnownCompatiblePackages()

      expect(packages).toContain('numpy')
      expect(packages).toContain('pandas')
      expect(packages).toContain('scipy')
    })

    it('returns non-empty list', () => {
      const packages = getKnownCompatiblePackages()

      expect(packages.length).toBeGreaterThan(50)
    })
  })

  describe('Common Package Scenarios', () => {
    it('handles web scraping stack', () => {
      const deps: PythonDependency[] = [
        { name: 'beautifulsoup4' },
        { name: 'lxml' },
        { name: 'html5lib' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(true)
    })

    it('handles data science stack', () => {
      const deps: PythonDependency[] = [
        { name: 'numpy' },
        { name: 'pandas' },
        { name: 'scipy' },
        { name: 'scikit-learn' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(true)
    })

    it('rejects database driver stack', () => {
      const deps: PythonDependency[] = [
        { name: 'psycopg2' },
        { name: 'pymysql' },
        { name: 'redis' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(false)
      expect(result.incompatiblePackages).toHaveLength(3)
    })

    it('rejects heavy ML frameworks', () => {
      const deps: PythonDependency[] = [
        { name: 'tensorflow' },
        { name: 'torch' },
        { name: 'keras' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(false)
      result.incompatiblePackages.forEach((p) => {
        expect(p.suggestion).toContain('Workers AI')
      })
    })

    it('rejects web frameworks', () => {
      const deps: PythonDependency[] = [
        { name: 'django' },
        { name: 'flask' },
        { name: 'fastapi' },
      ]
      const result = checkPyodideCompat(deps)

      expect(result.compatible).toBe(false)
      result.incompatiblePackages.forEach((p) => {
        expect(p.suggestion).toBeDefined()
      })
    })
  })
})
