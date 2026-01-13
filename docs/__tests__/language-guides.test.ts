/**
 * Language Guides Documentation Tests
 *
 * RED tests for Functions.do language guide documentation.
 * These tests verify that comprehensive language-specific guides exist
 * with working code examples and SDK documentation.
 *
 * Following TDD pattern - these tests should initially FAIL (RED)
 * because the documentation doesn't exist yet.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const DOCS_DIR = path.resolve(__dirname, '..')
const GUIDES_DIR = path.join(DOCS_DIR, 'guides', 'languages')

/**
 * Helper to check if a file exists
 */
function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

/**
 * Helper to read file content
 */
function readFile(filePath: string): string {
  if (!fileExists(filePath)) {
    return ''
  }
  return fs.readFileSync(filePath, 'utf-8')
}

/**
 * Validates TypeScript code syntax using basic pattern matching
 * Checks for common TypeScript patterns and syntax
 */
function isValidTypeScriptSyntax(code: string): boolean {
  // Remove comments for analysis
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Check for basic structure patterns
  const hasExport = /export\s+(default|const|function|class|interface|type)/.test(cleanCode)
  const hasImport = /import\s+.*from/.test(cleanCode)
  const hasFunction = /(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>|async\s+function)/.test(cleanCode)

  // Check for obvious syntax errors
  const balancedBraces = (cleanCode.match(/{/g) || []).length === (cleanCode.match(/}/g) || []).length
  const balancedParens = (cleanCode.match(/\(/g) || []).length === (cleanCode.match(/\)/g) || []).length

  return (hasExport || hasImport || hasFunction) && balancedBraces && balancedParens
}

/**
 * Validates Rust code syntax using basic pattern matching
 */
function isValidRustSyntax(code: string): boolean {
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const hasUse = /use\s+\w+/.test(cleanCode)
  const hasFn = /fn\s+\w+/.test(cleanCode)
  const hasStruct = /struct\s+\w+/.test(cleanCode)
  const hasMod = /mod\s+\w+/.test(cleanCode)
  const hasPub = /pub\s+(fn|struct|mod|use)/.test(cleanCode)

  const balancedBraces = (cleanCode.match(/{/g) || []).length === (cleanCode.match(/}/g) || []).length

  return (hasUse || hasFn || hasStruct || hasMod || hasPub) && balancedBraces
}

/**
 * Validates Go code syntax using basic pattern matching
 */
function isValidGoSyntax(code: string): boolean {
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const hasPackage = /package\s+\w+/.test(cleanCode)
  const hasImport = /import\s+(\([\s\S]*?\)|"[^"]+")/.test(cleanCode)
  const hasFunc = /func\s+(\([^)]*\)\s*)?\w+/.test(cleanCode)

  const balancedBraces = (cleanCode.match(/{/g) || []).length === (cleanCode.match(/}/g) || []).length

  return (hasPackage || hasImport || hasFunc) && balancedBraces
}

/**
 * Validates Python code syntax using basic pattern matching
 */
function isValidPythonSyntax(code: string): boolean {
  const cleanCode = code.replace(/#.*$/gm, '')

  const hasImport = /^(from\s+\w+\s+import|import\s+\w+)/m.test(cleanCode)
  const hasDef = /def\s+\w+\s*\(/.test(cleanCode)
  const hasClass = /class\s+\w+/.test(cleanCode)
  const hasAsync = /async\s+def/.test(cleanCode)

  // Check for balanced parentheses and brackets
  const balancedParens = (cleanCode.match(/\(/g) || []).length === (cleanCode.match(/\)/g) || []).length
  const balancedBrackets = (cleanCode.match(/\[/g) || []).length === (cleanCode.match(/\]/g) || []).length

  return (hasImport || hasDef || hasClass || hasAsync) && balancedParens && balancedBrackets
}

/**
 * Validates C# code syntax using basic pattern matching
 */
function isValidCSharpSyntax(code: string): boolean {
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const hasUsing = /using\s+\w+/.test(cleanCode)
  const hasNamespace = /namespace\s+\w+/.test(cleanCode)
  const hasClass = /class\s+\w+/.test(cleanCode)
  const hasMethod = /(public|private|protected|internal|static|async)\s+\w+\s+\w+\s*\(/.test(cleanCode)

  const balancedBraces = (cleanCode.match(/{/g) || []).length === (cleanCode.match(/}/g) || []).length

  return (hasUsing || hasNamespace || hasClass || hasMethod) && balancedBraces
}

/**
 * Extracts code blocks from markdown content
 */
function extractCodeBlocks(content: string, language: string): string[] {
  const regex = new RegExp(`\`\`\`${language}\\s*\\n([\\s\\S]*?)\`\`\``, 'g')
  const blocks: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1])
  }

  return blocks
}

describe('Language Guides Documentation', () => {
  describe('Guides Directory Structure', () => {
    it('should have guides directory', () => {
      const guidesDir = path.join(DOCS_DIR, 'guides')
      expect(fs.existsSync(guidesDir)).toBe(true)
    })

    it('should have languages subdirectory', () => {
      expect(fs.existsSync(GUIDES_DIR)).toBe(true)
    })

    it('should have all language guide files', () => {
      const requiredLanguages = ['typescript', 'rust', 'go', 'python', 'csharp']

      for (const lang of requiredLanguages) {
        const guidePath = path.join(GUIDES_DIR, `${lang}.md`)
        expect(fileExists(guidePath)).toBe(true)
      }
    })
  })

  describe('TypeScript Guide', () => {
    let guideContent: string
    const guidePath = path.join(GUIDES_DIR, 'typescript.md')

    beforeAll(() => {
      guideContent = readFile(guidePath)
    })

    it('should exist', () => {
      expect(fileExists(guidePath)).toBe(true)
    })

    it('should have a title', () => {
      expect(guideContent).toMatch(/^#\s+TypeScript/m)
    })

    it('should have a getting started section', () => {
      expect(guideContent.toLowerCase()).toMatch(/getting\s*started|quick\s*start/)
    })

    it('should document @dotdo/functions usage', () => {
      expect(guideContent).toMatch(/@dotdo\/functions-sdk/)
    })

    it('should have installation instructions', () => {
      expect(guideContent).toMatch(/npm\s+install|pnpm\s+add|yarn\s+add/)
    })

    it('should show function handler example', () => {
      expect(guideContent).toMatch(/export\s+default/)
      expect(guideContent).toMatch(/fetch\s*[:(]/)
    })

    it('should have code examples with typescript syntax', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'typescript')
      expect(codeBlocks.length).toBeGreaterThan(0)
    })

    it('should have syntactically valid TypeScript examples', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'typescript')

      for (const block of codeBlocks) {
        const isValid = isValidTypeScriptSyntax(block)
        expect(isValid).toBe(true)
      }
    })

    it('should document the Env interface', () => {
      expect(guideContent).toMatch(/interface\s+Env|Env\s+interface/)
    })

    it('should show Request/Response handling', () => {
      expect(guideContent).toMatch(/Request/)
      expect(guideContent).toMatch(/Response/)
    })

    it('should document tsconfig.json configuration', () => {
      expect(guideContent).toMatch(/tsconfig\.json/)
    })

    it('should document wrangler.toml configuration', () => {
      expect(guideContent).toMatch(/wrangler\.toml/)
    })

    it('should show deployment instructions', () => {
      expect(guideContent.toLowerCase()).toMatch(/deploy|deployment/)
    })

    it('should have testing section', () => {
      expect(guideContent.toLowerCase()).toMatch(/test|testing/)
    })

    it('should document type definitions', () => {
      expect(guideContent).toMatch(/@cloudflare\/workers-types/)
    })
  })

  describe('Rust Guide', () => {
    let guideContent: string
    const guidePath = path.join(GUIDES_DIR, 'rust.md')

    beforeAll(() => {
      guideContent = readFile(guidePath)
    })

    it('should exist', () => {
      expect(fileExists(guidePath)).toBe(true)
    })

    it('should have a title', () => {
      expect(guideContent).toMatch(/^#\s+Rust/m)
    })

    it('should document WASM compilation', () => {
      expect(guideContent.toLowerCase()).toMatch(/wasm|webassembly/)
    })

    it('should mention wasm32-unknown-unknown target', () => {
      expect(guideContent).toMatch(/wasm32-unknown-unknown/)
    })

    it('should document wasm-bindgen usage', () => {
      expect(guideContent).toMatch(/wasm-bindgen/)
    })

    it('should document wasm-pack usage', () => {
      expect(guideContent).toMatch(/wasm-pack/)
    })

    it('should have Cargo.toml configuration', () => {
      expect(guideContent).toMatch(/Cargo\.toml/)
    })

    it('should document cdylib crate type', () => {
      expect(guideContent).toMatch(/cdylib/)
    })

    it('should have code examples with rust syntax', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'rust')
      expect(codeBlocks.length).toBeGreaterThan(0)
    })

    it('should have syntactically valid Rust examples', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'rust')

      for (const block of codeBlocks) {
        const isValid = isValidRustSyntax(block)
        expect(isValid).toBe(true)
      }
    })

    it('should document #[wasm_bindgen] attribute', () => {
      expect(guideContent).toMatch(/#\[wasm_bindgen\]/)
    })

    it('should document memory management (alloc/dealloc)', () => {
      expect(guideContent.toLowerCase()).toMatch(/memory\s*management|alloc|dealloc/)
    })

    it('should document binary size optimization', () => {
      expect(guideContent.toLowerCase()).toMatch(/optim|size|lto|strip/)
    })

    it('should have build instructions', () => {
      expect(guideContent).toMatch(/cargo\s+build|wasm-pack\s+build/)
    })

    it('should document profile.release settings', () => {
      expect(guideContent).toMatch(/\[profile\.release\]/)
    })

    it('should show SDK integration', () => {
      expect(guideContent.toLowerCase()).toMatch(/sdk|functions\.do/)
    })
  })

  describe('Go Guide', () => {
    let guideContent: string
    const guidePath = path.join(GUIDES_DIR, 'go.md')

    beforeAll(() => {
      guideContent = readFile(guidePath)
    })

    it('should exist', () => {
      expect(fileExists(guidePath)).toBe(true)
    })

    it('should have a title', () => {
      expect(guideContent).toMatch(/^#\s+Go/m)
    })

    it('should document TinyGo requirements', () => {
      expect(guideContent.toLowerCase()).toMatch(/tinygo/)
    })

    it('should explain why TinyGo is needed instead of standard Go', () => {
      expect(guideContent.toLowerCase()).toMatch(/tinygo/)
      expect(guideContent.toLowerCase()).toMatch(/wasm|webassembly/)
    })

    it('should document TinyGo installation', () => {
      expect(guideContent.toLowerCase()).toMatch(/install.*tinygo|tinygo.*install/)
    })

    it('should document WASI target', () => {
      expect(guideContent.toLowerCase()).toMatch(/wasi/)
    })

    it('should have go.mod configuration', () => {
      expect(guideContent).toMatch(/go\.mod/)
    })

    it('should document Go version requirement (1.21+)', () => {
      expect(guideContent).toMatch(/1\.21|1\.22|1\.23/)
    })

    it('should document //go:wasmexport directive', () => {
      expect(guideContent).toMatch(/\/\/go:wasmexport/)
    })

    it('should have code examples with go syntax', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'go')
      expect(codeBlocks.length).toBeGreaterThan(0)
    })

    it('should have syntactically valid Go examples', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'go')

      for (const block of codeBlocks) {
        const isValid = isValidGoSyntax(block)
        expect(isValid).toBe(true)
      }
    })

    it('should document WASM-compatible types (int32, int64, float32, float64)', () => {
      expect(guideContent).toMatch(/int32|int64|float32|float64/)
    })

    it('should have Makefile example', () => {
      expect(guideContent).toMatch(/Makefile/)
    })

    it('should show tinygo build command', () => {
      expect(guideContent).toMatch(/tinygo\s+build/)
    })

    it('should document optimization flags', () => {
      expect(guideContent).toMatch(/-opt[=\s]|optimization/)
    })

    it('should show SDK integration', () => {
      expect(guideContent.toLowerCase()).toMatch(/sdk|functions\.do/)
    })

    it('should document binary size considerations', () => {
      expect(guideContent.toLowerCase()).toMatch(/size|binary|small/)
    })
  })

  describe('Python Guide', () => {
    let guideContent: string
    const guidePath = path.join(GUIDES_DIR, 'python.md')

    beforeAll(() => {
      guideContent = readFile(guidePath)
    })

    it('should exist', () => {
      expect(fileExists(guidePath)).toBe(true)
    })

    it('should have a title', () => {
      expect(guideContent).toMatch(/^#\s+Python/m)
    })

    it('should document Pyodide runtime', () => {
      expect(guideContent.toLowerCase()).toMatch(/pyodide/)
    })

    it('should explain what Pyodide is', () => {
      expect(guideContent.toLowerCase()).toMatch(/pyodide/)
      expect(guideContent.toLowerCase()).toMatch(/python.*wasm|wasm.*python|browser|webassembly/)
    })

    it('should document Python version requirements (3.10+)', () => {
      expect(guideContent).toMatch(/3\.10|3\.11|3\.12|python\s*>=?\s*3\.10/)
    })

    it('should have pyproject.toml configuration', () => {
      expect(guideContent).toMatch(/pyproject\.toml/)
    })

    it('should document Pyodide-compatible packages', () => {
      expect(guideContent.toLowerCase()).toMatch(/compatible|packages|dependencies/)
    })

    it('should warn about package limitations', () => {
      expect(guideContent.toLowerCase()).toMatch(/limit|restrict|not\s*support|pure\s*python/)
    })

    it('should have code examples with python syntax', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'python')
      expect(codeBlocks.length).toBeGreaterThan(0)
    })

    it('should have syntactically valid Python examples', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'python')

      for (const block of codeBlocks) {
        const isValid = isValidPythonSyntax(block)
        expect(isValid).toBe(true)
      }
    })

    it('should document async/await pattern', () => {
      expect(guideContent).toMatch(/async\s+def/)
      expect(guideContent).toMatch(/await/)
    })

    it('should show handler function signature', () => {
      expect(guideContent).toMatch(/def\s+handler|async\s+def\s+handler/)
    })

    it('should document Request/Response classes', () => {
      expect(guideContent).toMatch(/Request/)
      expect(guideContent).toMatch(/Response/)
    })

    it('should document type hints', () => {
      expect(guideContent).toMatch(/:\s*(str|int|dict|list|bool|Optional|Union)/)
    })

    it('should show SDK integration', () => {
      expect(guideContent.toLowerCase()).toMatch(/sdk|functions-do|functions\.do/)
    })

    it('should document local testing', () => {
      expect(guideContent.toLowerCase()).toMatch(/test|testing|pytest/)
    })

    it('should document memory/performance considerations', () => {
      expect(guideContent.toLowerCase()).toMatch(/memory|performance|cold\s*start/)
    })
  })

  describe('C# Guide', () => {
    let guideContent: string
    const guidePath = path.join(GUIDES_DIR, 'csharp.md')

    beforeAll(() => {
      guideContent = readFile(guidePath)
    })

    it('should exist', () => {
      expect(fileExists(guidePath)).toBe(true)
    })

    it('should have a title', () => {
      expect(guideContent).toMatch(/^#\s+(C#|CSharp)/mi)
    })

    it('should document .NET compilation to WASM', () => {
      expect(guideContent.toLowerCase()).toMatch(/\.net|dotnet/)
      expect(guideContent.toLowerCase()).toMatch(/wasm|webassembly/)
    })

    it('should document .NET version requirements', () => {
      expect(guideContent).toMatch(/\.NET\s*[78]|net[78]\.0/i)
    })

    it('should document AOT compilation', () => {
      expect(guideContent.toLowerCase()).toMatch(/aot|ahead.of.time|native/)
    })

    it('should have .csproj configuration', () => {
      expect(guideContent).toMatch(/\.csproj/)
    })

    it('should document wasm-experimental workload', () => {
      expect(guideContent.toLowerCase()).toMatch(/wasm-experimental|wasm\s*workload/)
    })

    it('should have code examples with csharp syntax', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'csharp')
      expect(codeBlocks.length).toBeGreaterThan(0)
    })

    it('should have syntactically valid C# examples', () => {
      const codeBlocks = extractCodeBlocks(guideContent, 'csharp')

      for (const block of codeBlocks) {
        const isValid = isValidCSharpSyntax(block)
        expect(isValid).toBe(true)
      }
    })

    it('should document JSExport attribute', () => {
      expect(guideContent).toMatch(/JSExport|\[Export\]/)
    })

    it('should document PublishAot property', () => {
      expect(guideContent).toMatch(/PublishAot/)
    })

    it('should document trimming for size optimization', () => {
      expect(guideContent.toLowerCase()).toMatch(/trim|size|optim/)
    })

    it('should show dotnet publish command', () => {
      expect(guideContent).toMatch(/dotnet\s+publish/)
    })

    it('should document async/await pattern', () => {
      expect(guideContent).toMatch(/async/)
      expect(guideContent).toMatch(/Task/)
    })

    it('should show SDK integration', () => {
      expect(guideContent.toLowerCase()).toMatch(/sdk|functions\.do/)
    })

    it('should document NuGet packages', () => {
      expect(guideContent.toLowerCase()).toMatch(/nuget|package/)
    })

    it('should have binary size considerations', () => {
      expect(guideContent.toLowerCase()).toMatch(/size|binary|mb/)
    })
  })

  describe('SDK Documentation Per Language', () => {
    const languages = [
      { name: 'TypeScript', file: 'typescript.md', sdkPattern: /@dotdo\/functions-sdk/ },
      { name: 'Rust', file: 'rust.md', sdkPattern: /functions-do|dotdo/i },
      { name: 'Go', file: 'go.md', sdkPattern: /functions-do|dotdo/i },
      { name: 'Python', file: 'python.md', sdkPattern: /functions-do|dotdo/i },
      { name: 'C#', file: 'csharp.md', sdkPattern: /Functions\.Do|DotDo/i },
    ]

    for (const lang of languages) {
      describe(`${lang.name} SDK`, () => {
        let guideContent: string
        const guidePath = path.join(GUIDES_DIR, lang.file)

        beforeAll(() => {
          guideContent = readFile(guidePath)
        })

        it(`should document ${lang.name} SDK installation`, () => {
          expect(guideContent.toLowerCase()).toMatch(/install|add|dependency/)
        })

        it(`should show ${lang.name} SDK import/usage`, () => {
          expect(guideContent).toMatch(lang.sdkPattern)
        })

        it(`should have ${lang.name} SDK API examples`, () => {
          // Should show actual function calls or method usage
          expect(guideContent.toLowerCase()).toMatch(/api|function|method|invoke|call/)
        })

        it(`should document ${lang.name} SDK configuration`, () => {
          expect(guideContent.toLowerCase()).toMatch(/config|setting|option/)
        })
      })
    }
  })

  describe('Code Example Quality', () => {
    const languages = [
      { name: 'TypeScript', file: 'typescript.md', lang: 'typescript' },
      { name: 'Rust', file: 'rust.md', lang: 'rust' },
      { name: 'Go', file: 'go.md', lang: 'go' },
      { name: 'Python', file: 'python.md', lang: 'python' },
      { name: 'C#', file: 'csharp.md', lang: 'csharp' },
    ]

    for (const { name, file, lang } of languages) {
      describe(`${name} Examples`, () => {
        let guideContent: string
        let codeBlocks: string[]

        beforeAll(() => {
          const guidePath = path.join(GUIDES_DIR, file)
          guideContent = readFile(guidePath)
          codeBlocks = extractCodeBlocks(guideContent, lang)
        })

        it(`should have at least 3 ${name} code examples`, () => {
          expect(codeBlocks.length).toBeGreaterThanOrEqual(3)
        })

        it(`should have a complete "Hello World" example`, () => {
          const hasHelloWorld = codeBlocks.some(
            (block) => block.toLowerCase().includes('hello') || block.toLowerCase().includes('world')
          )
          expect(hasHelloWorld).toBe(true)
        })

        it(`should have a complete handler example`, () => {
          const hasHandler = codeBlocks.some(
            (block) => block.toLowerCase().includes('handler') || block.toLowerCase().includes('fetch')
          )
          expect(hasHandler).toBe(true)
        })

        it(`should have examples with comments explaining the code`, () => {
          const hasComments = codeBlocks.some((block) => {
            // Check for language-appropriate comments
            if (lang === 'python') {
              return /#[^!]/.test(block)
            }
            return /\/\/|\/\*/.test(block)
          })
          expect(hasComments).toBe(true)
        })
      })
    }
  })

  describe('Cross-Language Consistency', () => {
    const languageFiles = ['typescript.md', 'rust.md', 'go.md', 'python.md', 'csharp.md']
    const guides: Record<string, string> = {}

    beforeAll(() => {
      for (const file of languageFiles) {
        const guidePath = path.join(GUIDES_DIR, file)
        guides[file] = readFile(guidePath)
      }
    })

    it('all guides should have installation section', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/install/)
      }
    })

    it('all guides should have deployment section', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/deploy/)
      }
    })

    it('all guides should have configuration section', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/config/)
      }
    })

    it('all guides should have testing section', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/test/)
      }
    })

    it('all guides should have troubleshooting or FAQ section', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/troubleshoot|faq|common\s*issue|problem/)
      }
    })

    it('all guides should reference wrangler.toml', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content).toMatch(/wrangler\.toml/)
      }
    })

    it('all guides should mention Functions.do', () => {
      for (const [file, content] of Object.entries(guides)) {
        expect(content.toLowerCase()).toMatch(/functions\.do/)
      }
    })
  })

  describe('Index/Overview Documentation', () => {
    const indexPath = path.join(GUIDES_DIR, 'index.md')

    it('should have languages index file', () => {
      expect(fileExists(indexPath)).toBe(true)
    })

    it('should list all supported languages', () => {
      const content = readFile(indexPath)
      expect(content.toLowerCase()).toMatch(/typescript/)
      expect(content.toLowerCase()).toMatch(/rust/)
      expect(content.toLowerCase()).toMatch(/go/)
      expect(content.toLowerCase()).toMatch(/python/)
      expect(content.toLowerCase()).toMatch(/c#|csharp/)
    })

    it('should have links to individual language guides', () => {
      const content = readFile(indexPath)
      expect(content).toMatch(/\[.*\]\(.*typescript.*\)/i)
      expect(content).toMatch(/\[.*\]\(.*rust.*\)/i)
      expect(content).toMatch(/\[.*\]\(.*go.*\)/i)
      expect(content).toMatch(/\[.*\]\(.*python.*\)/i)
      expect(content).toMatch(/\[.*\]\(.*csharp.*\)/i)
    })

    it('should have language comparison table', () => {
      const content = readFile(indexPath)
      expect(content).toMatch(/\|.*\|/)
    })

    it('should mention WASM for compiled languages', () => {
      const content = readFile(indexPath)
      expect(content.toLowerCase()).toMatch(/wasm|webassembly/)
    })
  })
})
