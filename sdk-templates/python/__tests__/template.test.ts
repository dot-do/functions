/**
 * Tests for the Python function template
 *
 * These tests verify that the template creates valid configuration files
 * and source code that follows the expected patterns for Functions.do Python functions.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TEMPLATE_DIR = path.resolve(__dirname, '..')

describe('Python Template', () => {
  describe('pyproject.toml', () => {
    let pyprojectContent: string
    let pyprojectToml: Record<string, unknown>

    beforeAll(() => {
      const pyprojectPath = path.join(TEMPLATE_DIR, 'pyproject.toml')
      expect(fs.existsSync(pyprojectPath)).toBe(true)
      pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8')
      // Simple TOML parsing for validation (not full TOML parser)
      pyprojectToml = {}
    })

    it('should exist', () => {
      const pyprojectPath = path.join(TEMPLATE_DIR, 'pyproject.toml')
      expect(fs.existsSync(pyprojectPath)).toBe(true)
    })

    it('should have a valid build-system section', () => {
      expect(pyprojectContent).toMatch(/\[build-system\]/)
      expect(pyprojectContent).toMatch(/requires\s*=/)
      expect(pyprojectContent).toMatch(/build-backend\s*=/)
    })

    it('should have a project section with name', () => {
      expect(pyprojectContent).toMatch(/\[project\]/)
      expect(pyprojectContent).toMatch(/^name\s*=/m)
    })

    it('should have a valid version field', () => {
      expect(pyprojectContent).toMatch(/^version\s*=\s*["']\d+\.\d+\.\d+["']/m)
    })

    it('should specify Python version requirement', () => {
      expect(pyprojectContent).toMatch(/requires-python\s*=/)
      // Should require Python 3.10 or later for Pyodide compatibility
      expect(pyprojectContent).toMatch(/>=\s*3\.10/)
    })

    it('should have functions-do as a dependency', () => {
      expect(pyprojectContent).toMatch(/functions-do/)
    })

    it('should have dev dependencies section', () => {
      expect(pyprojectContent).toMatch(/\[project\.optional-dependencies\]/)
      expect(pyprojectContent).toMatch(/dev\s*=/)
    })

    it('should include pytest in dev dependencies', () => {
      expect(pyprojectContent).toMatch(/pytest/)
    })

    it('should have functions-do configuration section', () => {
      expect(pyprojectContent).toMatch(/\[tool\.functions-do\]/)
    })

    it('should specify Python runtime in functions-do config', () => {
      expect(pyprojectContent).toMatch(/runtime\s*=\s*["']python["']/)
    })

    it('should specify handler entry point', () => {
      expect(pyprojectContent).toMatch(/handler\s*=/)
      expect(pyprojectContent).toMatch(/src\.handler/)
    })

    it('should have ruff configuration for linting', () => {
      expect(pyprojectContent).toMatch(/\[tool\.ruff\]/)
    })

    it('should have mypy configuration for type checking', () => {
      expect(pyprojectContent).toMatch(/\[tool\.mypy\]/)
    })

    it('should have pytest configuration', () => {
      expect(pyprojectContent).toMatch(/\[tool\.pytest/)
    })
  })

  describe('requirements.txt', () => {
    let requirementsContent: string

    beforeAll(() => {
      const requirementsPath = path.join(TEMPLATE_DIR, 'requirements.txt')
      expect(fs.existsSync(requirementsPath)).toBe(true)
      requirementsContent = fs.readFileSync(requirementsPath, 'utf-8')
    })

    it('should exist', () => {
      const requirementsPath = path.join(TEMPLATE_DIR, 'requirements.txt')
      expect(fs.existsSync(requirementsPath)).toBe(true)
    })

    it('should have descriptive header comments', () => {
      expect(requirementsContent).toMatch(/^#/m)
      // Should mention Functions.do or Pyodide compatibility
      expect(requirementsContent.toLowerCase()).toMatch(/functions\.do|pyodide/)
    })

    it('should document Pyodide compatibility requirements', () => {
      expect(requirementsContent.toLowerCase()).toMatch(/pyodide/)
    })

    it('should include pip install instructions', () => {
      expect(requirementsContent).toMatch(/pip install/)
    })
  })

  describe('src/handler.py', () => {
    let handlerContent: string

    beforeAll(() => {
      const handlerPath = path.join(TEMPLATE_DIR, 'src', 'handler.py')
      expect(fs.existsSync(handlerPath)).toBe(true)
      handlerContent = fs.readFileSync(handlerPath, 'utf-8')
    })

    it('should exist', () => {
      const handlerPath = path.join(TEMPLATE_DIR, 'src', 'handler.py')
      expect(fs.existsSync(handlerPath)).toBe(true)
    })

    it('should have module docstring', () => {
      // Python files should have docstrings
      expect(handlerContent).toMatch(/^"""[\s\S]*?"""/m)
    })

    it('should use future annotations for Python 3.10+ compatibility', () => {
      expect(handlerContent).toMatch(/from __future__ import annotations/)
    })

    it('should import required typing modules', () => {
      expect(handlerContent).toMatch(/from typing import/)
    })

    it('should define Request class or type', () => {
      expect(handlerContent).toMatch(/class\s+Request/)
    })

    it('should define Response class or type', () => {
      expect(handlerContent).toMatch(/class\s+Response/)
    })

    it('should have a handler function', () => {
      expect(handlerContent).toMatch(/async\s+def\s+handler/)
    })

    it('should have handler that accepts args dict', () => {
      // Handler should accept a dict as argument
      expect(handlerContent).toMatch(/def\s+handler\s*\(\s*args\s*:\s*dict/)
    })

    it('should have handler that returns a dict', () => {
      // Handler should return a dict
      expect(handlerContent).toMatch(/handler.*->\s*dict/)
    })

    it('should support fetch request type', () => {
      expect(handlerContent).toMatch(/["']fetch["']/)
    })

    it('should support RPC request type', () => {
      expect(handlerContent).toMatch(/["']rpc["']/)
    })

    it('should define Handler class', () => {
      expect(handlerContent).toMatch(/class\s+Handler/)
    })

    it('should have fetch method on Handler', () => {
      expect(handlerContent).toMatch(/async\s+def\s+fetch\s*\(self/)
    })

    it('should use dataclasses for type definitions', () => {
      expect(handlerContent).toMatch(/@dataclass/)
      expect(handlerContent).toMatch(/from dataclasses import/)
    })

    it('should have Response.json factory method', () => {
      expect(handlerContent).toMatch(/def\s+json\s*\(\s*cls/)
    })

    it('should have Response.text factory method', () => {
      expect(handlerContent).toMatch(/def\s+text\s*\(\s*cls/)
    })

    it('should have main function for local testing', () => {
      expect(handlerContent).toMatch(/def\s+main\s*\(\s*\)/)
    })

    it('should have if __name__ == "__main__" block', () => {
      expect(handlerContent).toMatch(/if\s+__name__\s*==\s*["']__main__["']/)
    })
  })

  describe('wrangler.toml', () => {
    let wranglerContent: string

    beforeAll(() => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      // This test expects wrangler.toml to exist - it currently doesn't
      if (fs.existsSync(wranglerPath)) {
        wranglerContent = fs.readFileSync(wranglerPath, 'utf-8')
      } else {
        wranglerContent = ''
      }
    })

    it('should exist', () => {
      const wranglerPath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(wranglerPath)).toBe(true)
    })

    it('should have a name field', () => {
      expect(wranglerContent).toMatch(/^name\s*=/m)
    })

    it('should have a main entry point', () => {
      expect(wranglerContent).toMatch(/^main\s*=/m)
    })

    it('should have compatibility_date', () => {
      expect(wranglerContent).toMatch(/^compatibility_date\s*=/m)
    })

    it('should have compatibility_flags for Python', () => {
      expect(wranglerContent).toMatch(/compatibility_flags/)
      expect(wranglerContent).toMatch(/python_workers/)
    })
  })

  describe('Template structure', () => {
    it('should have src directory', () => {
      const srcDir = path.join(TEMPLATE_DIR, 'src')
      expect(fs.existsSync(srcDir)).toBe(true)
      expect(fs.statSync(srcDir).isDirectory()).toBe(true)
    })

    it('should have src/__init__.py', () => {
      const initPath = path.join(TEMPLATE_DIR, 'src', '__init__.py')
      expect(fs.existsSync(initPath)).toBe(true)
    })

    it('should have src/handler.py', () => {
      const handlerPath = path.join(TEMPLATE_DIR, 'src', 'handler.py')
      expect(fs.existsSync(handlerPath)).toBe(true)
    })

    it('should have tests directory', () => {
      const testsDir = path.join(TEMPLATE_DIR, 'tests')
      expect(fs.existsSync(testsDir)).toBe(true)
      expect(fs.statSync(testsDir).isDirectory()).toBe(true)
    })

    it('should have tests/__init__.py', () => {
      const initPath = path.join(TEMPLATE_DIR, 'tests', '__init__.py')
      expect(fs.existsSync(initPath)).toBe(true)
    })

    it('should have pyproject.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'pyproject.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have requirements.txt', () => {
      const filePath = path.join(TEMPLATE_DIR, 'requirements.txt')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have wrangler.toml', () => {
      const filePath = path.join(TEMPLATE_DIR, 'wrangler.toml')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should have README.md', () => {
      const filePath = path.join(TEMPLATE_DIR, 'README.md')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('should not have __pycache__ in template', () => {
      const pycachePath = path.join(TEMPLATE_DIR, '__pycache__')
      expect(fs.existsSync(pycachePath)).toBe(false)
    })

    it('should not have .venv in template', () => {
      const venvPath = path.join(TEMPLATE_DIR, '.venv')
      expect(fs.existsSync(venvPath)).toBe(false)
    })

    it('should not have .pyc files in template', () => {
      const srcPycache = path.join(TEMPLATE_DIR, 'src', '__pycache__')
      expect(fs.existsSync(srcPycache)).toBe(false)
    })
  })

  describe('Handler pattern validation', () => {
    let handlerContent: string

    beforeAll(() => {
      const handlerPath = path.join(TEMPLATE_DIR, 'src', 'handler.py')
      if (fs.existsSync(handlerPath)) {
        handlerContent = fs.readFileSync(handlerPath, 'utf-8')
      } else {
        handlerContent = ''
      }
    })

    it('should define Env class for environment bindings', () => {
      expect(handlerContent).toMatch(/class\s+Env/)
    })

    it('should define ExecutionContext class', () => {
      expect(handlerContent).toMatch(/class\s+ExecutionContext/)
    })

    it('should have wait_until method on ExecutionContext', () => {
      expect(handlerContent).toMatch(/def\s+wait_until/)
    })

    it('should define Headers class for HTTP headers', () => {
      expect(handlerContent).toMatch(/class\s+Headers/)
    })

    it('should have case-insensitive header access', () => {
      // Headers should normalize keys to lowercase
      expect(handlerContent).toMatch(/\.lower\(\)/)
    })

    it('should define RpcCall class for RPC support', () => {
      expect(handlerContent).toMatch(/class\s+RpcCall/)
    })

    it('should define RpcResult class for RPC responses', () => {
      expect(handlerContent).toMatch(/class\s+RpcResult/)
    })

    it('should have error handling in RPC invocation', () => {
      expect(handlerContent).toMatch(/except\s+Exception/)
    })

    it('should support scheduled handler', () => {
      expect(handlerContent).toMatch(/async\s+def\s+scheduled/)
    })

    it('should have type hints throughout', () => {
      // Should have type annotations on function parameters and returns
      expect(handlerContent).toMatch(/def\s+\w+\s*\([^)]*:\s*\w+/)
      expect(handlerContent).toMatch(/->\s*\w+/)
    })

    it('should use async/await pattern', () => {
      expect(handlerContent).toMatch(/async\s+def/)
      expect(handlerContent).toMatch(/await\s+/)
    })

    it('should have JSON serialization helpers', () => {
      expect(handlerContent).toMatch(/import\s+json/)
      expect(handlerContent).toMatch(/json\.dumps/)
      expect(handlerContent).toMatch(/json\.loads/)
    })

    it('should handle different request types', () => {
      // Handler should branch on request type
      expect(handlerContent).toMatch(/request_type\s*=/)
      expect(handlerContent).toMatch(/if\s+request_type\s*==/)
    })
  })
})
