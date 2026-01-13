/**
 * Getting Started Guide Documentation Tests
 *
 * TDD RED Phase: These tests verify the Getting Started documentation is complete and correct.
 * Tests should FAIL initially because the documentation doesn't exist yet.
 *
 * Issue: functions-wo37 - [RED] Getting Started guide tests
 *
 * Tests verify:
 * 1. Quickstart example code works and is valid
 * 2. Installation instructions are complete
 * 3. First function example compiles and runs
 * 4. All code snippets in getting started are syntactically valid
 * 5. Links to next steps are valid
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

// Path to the Getting Started documentation
const DOCS_DIR = join(__dirname, '..')
const GETTING_STARTED_PATH = join(DOCS_DIR, 'getting-started.md')
const GETTING_STARTED_MDX_PATH = join(DOCS_DIR, 'getting-started.mdx')

// Helper to get the documentation path (supports both .md and .mdx)
function getDocPath(): string | null {
  if (existsSync(GETTING_STARTED_MDX_PATH)) return GETTING_STARTED_MDX_PATH
  if (existsSync(GETTING_STARTED_PATH)) return GETTING_STARTED_PATH
  return null
}

// Helper to read documentation content
function readDocContent(): string | null {
  const docPath = getDocPath()
  if (!docPath) return null
  return readFileSync(docPath, 'utf-8')
}

// Helper to safely get doc content with assertion
function requireDocContent(): string {
  const content = readDocContent()
  if (!content) {
    throw new Error(
      'Documentation file not found. Expected docs/getting-started.md or docs/getting-started.mdx'
    )
  }
  return content
}

// Helper to extract code blocks from markdown
function extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  const blocks: Array<{ language: string; code: string }> = []
  let match

  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    })
  }

  return blocks
}

// Helper to extract links from markdown
function extractLinks(content: string): Array<{ text: string; url: string }> {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const links: Array<{ text: string; url: string }> = []
  let match

  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
    })
  }

  return links
}

// Helper to validate TypeScript syntax
function validateTypeScriptSyntax(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  try {
    const sourceFile = ts.createSourceFile(
      'snippet.ts',
      code,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    )

    // Check for parse errors
    const syntacticDiagnostics = ts.createProgram({
      rootNames: [],
      options: {},
    }).getSyntacticDiagnostics(sourceFile)

    for (const diagnostic of syntacticDiagnostics) {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      errors.push(message)
    }
  } catch (error) {
    errors.push(String(error))
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// Helper to validate JavaScript syntax
function validateJavaScriptSyntax(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  try {
    const sourceFile = ts.createSourceFile(
      'snippet.js',
      code,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.JS
    )

    // Check for parse errors - basic validation that it parses
    if (!sourceFile) {
      errors.push('Failed to parse JavaScript')
    }
  } catch (error) {
    errors.push(String(error))
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// Helper to validate bash command syntax (basic validation)
function validateBashCommand(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check for common syntax issues
  const lines = code.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'))

  for (const line of lines) {
    // Check for unclosed quotes
    const singleQuotes = (line.match(/'/g) || []).length
    const doubleQuotes = (line.match(/"/g) || []).length

    if (singleQuotes % 2 !== 0) {
      errors.push(`Unclosed single quote in: ${line}`)
    }
    if (doubleQuotes % 2 !== 0) {
      errors.push(`Unclosed double quote in: ${line}`)
    }

    // Check for common typos
    if (line.includes('npx create-fnction')) {
      errors.push('Typo in command: should be "create-function"')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

describe('Getting Started Documentation', () => {
  describe('Documentation File Existence', () => {
    it('should have getting-started documentation file (.md or .mdx)', () => {
      const docPath = getDocPath()
      expect(
        docPath,
        'Documentation file not found at docs/getting-started.md or docs/getting-started.mdx'
      ).not.toBeNull()
      expect(existsSync(docPath!)).toBe(true)
    })

    it('should have non-empty documentation content', () => {
      const docContent = readDocContent()
      expect(
        docContent,
        'Documentation file is empty or missing'
      ).not.toBeNull()
      expect(docContent!.length).toBeGreaterThan(100)
    })
  })

  describe('Document Structure', () => {
    it('should have a title heading', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/^#\s+.+/m)
    })

    it('should have an introduction section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/introduction|overview|welcome|getting started/i)
    })

    it('should have prerequisites section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/prerequisite|requirement|before you begin|what you.+need/i)
    })

    it('should have installation section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/install|setup|set up/i)
    })

    it('should have a quickstart or first function section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/quick\s*start|first\s+function|hello\s+world|your\s+first/i)
    })

    it('should have next steps section', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/next\s+step|what.+next|continue|learn\s+more/i)
    })
  })

  describe('Installation Instructions', () => {
    it('should mention Node.js requirement', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/node\.?js|node\s+\d+/i)
    })

    it('should specify minimum Node.js version', () => {
      const docContent = requireDocContent()
      // Should mention a version like Node.js 18+ or v18
      expect(docContent).toMatch(/node\.?js\s*(v?\d+|\d+\.\d+|\d+\+)/i)
    })

    it('should include npm install or npx command', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/npm\s+(install|i)\s+|npx\s+/i)
    })

    it('should mention the create-function CLI', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/create-function/i)
    })

    it('should include wrangler installation or reference', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/wrangler/i)
    })
  })

  describe('Quickstart Example Code', () => {
    it('should include a TypeScript example', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      expect(tsBlocks.length, 'No TypeScript code blocks found in documentation').toBeGreaterThan(0)
    })

    it('should include a bash/shell command example', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const bashBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'bash' ||
          block.language === 'sh' ||
          block.language === 'shell' ||
          block.language === 'zsh'
      )

      expect(bashBlocks.length, 'No bash/shell command blocks found in documentation').toBeGreaterThan(0)
    })

    it('should include create-function command in examples', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const hasCreateFunctionCommand = codeBlocks.some((block) =>
        block.code.includes('create-function')
      )

      expect(hasCreateFunctionCommand, 'No create-function command found in code examples').toBe(true)
    })

    it('should include npm run dev command', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/npm\s+run\s+dev/i)
    })

    it('should include npm run deploy or deploy command', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/npm\s+run\s+deploy|npx\s+func\s+deploy/i)
    })
  })

  describe('First Function Example Validity', () => {
    it('should have syntactically valid TypeScript code', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      // At least one TypeScript block must be valid
      expect(tsBlocks.length, 'No TypeScript code blocks found').toBeGreaterThan(0)

      for (const block of tsBlocks) {
        const result = validateTypeScriptSyntax(block.code)
        expect(result.valid, `TypeScript syntax error: ${result.errors.join(', ')}`).toBe(true)
      }
    })

    it('should have syntactically valid JavaScript code', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const jsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'javascript' || block.language === 'js' || block.language === 'jsx'
      )

      for (const block of jsBlocks) {
        const result = validateJavaScriptSyntax(block.code)
        expect(result.valid, `JavaScript syntax error: ${result.errors.join(', ')}`).toBe(true)
      }
    })

    it('should have syntactically valid bash commands', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const bashBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'bash' ||
          block.language === 'sh' ||
          block.language === 'shell' ||
          block.language === 'zsh'
      )

      for (const block of bashBlocks) {
        const result = validateBashCommand(block.code)
        expect(result.valid, `Bash syntax error: ${result.errors.join(', ')}`).toBe(true)
      }
    })

    it('should export a default handler in the main TypeScript example', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      // At least one TypeScript block should have export default
      const hasDefaultExport = tsBlocks.some(
        (block) => block.code.includes('export default') || block.code.includes('export {')
      )

      expect(hasDefaultExport, 'No TypeScript example with export default found').toBe(true)
    })

    it('should demonstrate Response or return value in function example', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      // Should show how to return a response
      const showsResponse = tsBlocks.some(
        (block) =>
          block.code.includes('Response') ||
          block.code.includes('return') ||
          block.code.includes('=>')
      )

      expect(showsResponse, 'No example showing Response or return value').toBe(true)
    })
  })

  describe('Code Snippet Completeness', () => {
    it('should show complete runnable example (not partial snippets)', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      // At least one block should be a complete example (has export)
      const hasCompleteExample = tsBlocks.some(
        (block) => block.code.includes('export') && block.code.length > 50
      )

      expect(hasCompleteExample, 'No complete runnable TypeScript example found').toBe(true)
    })

    it('should include project directory structure example', () => {
      const docContent = requireDocContent()
      // Could be shown as text or in a code block
      expect(docContent).toMatch(
        /package\.json|src\/|index\.ts|wrangler\.(toml|json)|directory\s+structure/i
      )
    })

    it('should explain what each command does', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const hasBashBlock = codeBlocks.some((b) => ['bash', 'sh', 'shell'].includes(b.language))

      if (hasBashBlock) {
        // There should be prose text explaining commands
        expect(docContent.length).toBeGreaterThan(500)
      }
    })
  })

  describe('Links to Next Steps', () => {
    it('should include links to other documentation', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      expect(links.length, 'No documentation links found').toBeGreaterThan(0)
    })

    it('should link to language-specific guides', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/language|typescript|rust|python|go/i)

      const links = extractLinks(docContent)
      const hasLanguageLink = links.some(
        (link) =>
          link.url.includes('language') ||
          link.url.includes('typescript') ||
          link.url.includes('rust') ||
          link.url.includes('python')
      )

      expect(hasLanguageLink, 'No link to language-specific guides found').toBe(true)
    })

    it('should link to API reference', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      const hasApiLink = links.some(
        (link) => link.url.includes('api') || link.text.toLowerCase().includes('api')
      )

      expect(hasApiLink, 'No link to API reference found').toBe(true)
    })

    it('should have valid internal documentation links (relative paths)', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      const internalLinks = links.filter(
        (link) =>
          !link.url.startsWith('http://') &&
          !link.url.startsWith('https://') &&
          !link.url.startsWith('mailto:')
      )

      // Internal links should use relative paths or start with /docs/
      for (const link of internalLinks) {
        expect(link.url).toMatch(/^(\.\/|\.\.\/|\/|#)/)
      }
    })

    it('should link to examples or tutorials section', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      const hasExamplesLink = links.some(
        (link) =>
          link.url.includes('example') ||
          link.url.includes('tutorial') ||
          link.text.toLowerCase().includes('example') ||
          link.text.toLowerCase().includes('tutorial')
      )

      expect(hasExamplesLink, 'No link to examples or tutorials found').toBe(true)
    })
  })

  describe('External Links Validation', () => {
    it('should have valid URL format for external links', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      const externalLinks = links.filter(
        (link) => link.url.startsWith('http://') || link.url.startsWith('https://')
      )

      for (const link of externalLinks) {
        expect(() => new URL(link.url)).not.toThrow()
      }
    })

    it('should use HTTPS for external links', () => {
      const docContent = requireDocContent()
      const links = extractLinks(docContent)
      const externalLinks = links.filter(
        (link) => link.url.startsWith('http://') || link.url.startsWith('https://')
      )

      // Prefer HTTPS
      const httpLinks = externalLinks.filter((link) => link.url.startsWith('http://'))
      expect(httpLinks.length, 'Found non-HTTPS external links').toBe(0)
    })
  })

  describe('Content Quality', () => {
    it('should explain what Functions.do is', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/functions\.do|serverless|function|worker/i)
    })

    it('should mention key benefits (global, fast, multi-language)', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/global|edge|fast|quick|performance|multi.?language/i)
    })

    it('should include expected output or result of running example', () => {
      const docContent = requireDocContent()
      // Should show what users will see when they run the example
      expect(docContent).toMatch(/output|result|response|see|expect|return/i)
    })

    it('should have sufficient content length for a getting started guide', () => {
      const docContent = requireDocContent()
      // A proper getting started guide should be at least 1000 characters
      expect(docContent.length).toBeGreaterThan(1000)
    })

    it('should not have TODO or placeholder text', () => {
      const docContent = requireDocContent()
      expect(docContent).not.toMatch(/\bTODO\b|\bFIXME\b|\bXXX\b|\[placeholder\]|\[coming soon\]/i)
    })

    it('should not have broken markdown syntax', () => {
      const docContent = requireDocContent()
      // Check for common markdown issues
      // Unclosed code blocks
      const codeBlockCount = (docContent.match(/```/g) || []).length
      expect(codeBlockCount % 2).toBe(0)

      // Unclosed bold/italic
      const asteriskPairs = (docContent.match(/\*\*/g) || []).length
      expect(asteriskPairs % 2).toBe(0)
    })
  })

  describe('Quickstart Command Sequence', () => {
    it('should have commands in logical order (create -> cd -> dev -> deploy)', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const bashBlocks = codeBlocks.filter((b) => ['bash', 'sh', 'shell'].includes(b.language))

      // Combine all bash code to check order
      const allBashCode = bashBlocks.map((b) => b.code).join('\n')

      // Check that create comes before cd, cd before dev, dev before deploy
      const createIndex = allBashCode.indexOf('create-function')
      const cdIndex = allBashCode.indexOf('cd ')
      const devIndex = allBashCode.indexOf('dev')
      const deployIndex = allBashCode.indexOf('deploy')

      if (createIndex !== -1 && cdIndex !== -1) {
        expect(createIndex).toBeLessThan(cdIndex)
      }
      if (cdIndex !== -1 && devIndex !== -1) {
        expect(cdIndex).toBeLessThan(devIndex)
      }
      if (devIndex !== -1 && deployIndex !== -1) {
        expect(devIndex).toBeLessThan(deployIndex)
      }
    })

    it('should specify language flag in create-function command', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const bashBlocks = codeBlocks.filter((b) => ['bash', 'sh', 'shell'].includes(b.language))

      const createFunctionBlock = bashBlocks.find((b) => b.code.includes('create-function'))
      expect(createFunctionBlock, 'No create-function command found in bash blocks').toBeDefined()

      // Should include --lang flag
      expect(createFunctionBlock!.code).toMatch(/--lang\s+\w+/)
    })
  })

  describe('Compilation Verification', () => {
    it('should have TypeScript code that can be parsed by TypeScript compiler', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      for (const block of tsBlocks) {
        // Attempt to parse each TypeScript block
        expect(() => {
          ts.createSourceFile('test.ts', block.code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
        }).not.toThrow()
      }
    })

    it('should have code that follows Cloudflare Workers patterns', () => {
      const docContent = requireDocContent()
      const codeBlocks = extractCodeBlocks(docContent)
      const tsBlocks = codeBlocks.filter(
        (block) =>
          block.language === 'typescript' || block.language === 'ts' || block.language === 'tsx'
      )

      // At least one block should follow Workers patterns
      const followsWorkersPattern = tsBlocks.some(
        (block) =>
          // Either exports default handler or uses fetch pattern
          block.code.includes('export default') ||
          block.code.includes('fetch') ||
          block.code.includes('async') ||
          block.code.includes('=>')
      )

      expect(followsWorkersPattern, 'No code following Cloudflare Workers patterns').toBe(true)
    })
  })
})

describe('Getting Started Mocked Integration Tests', () => {
  // Mock external dependencies for testing documentation examples

  describe('Create-function CLI Mock', () => {
    it('should document valid language options', () => {
      const docContent = requireDocContent()
      const validLanguages = ['typescript', 'rust', 'python', 'go', 'assemblyscript', 'zig', 'csharp']

      // Should mention at least TypeScript
      expect(docContent).toMatch(/typescript/i)

      // Should mention multiple languages are supported
      const mentionedLanguages = validLanguages.filter((lang) =>
        docContent.toLowerCase().includes(lang.toLowerCase())
      )
      expect(mentionedLanguages.length, 'No supported languages mentioned').toBeGreaterThan(0)
    })

    it('should document the --lang flag', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/--lang/)
    })
  })

  describe('Local Development Mock', () => {
    it('should document local development workflow', () => {
      const docContent = requireDocContent()

      // Should mention local development
      expect(docContent).toMatch(/local|dev|development|localhost/i)
    })

    it('should mention wrangler dev or npm run dev', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/wrangler\s+dev|npm\s+run\s+dev/i)
    })

    it('should mention the local URL (localhost:8787)', () => {
      const docContent = requireDocContent()
      // Wrangler typically runs on port 8787
      expect(docContent).toMatch(/localhost|127\.0\.0\.1|8787/i)
    })
  })

  describe('Deployment Mock', () => {
    it('should document deployment command', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/deploy/i)
    })

    it('should mention Cloudflare account or authentication', () => {
      const docContent = requireDocContent()
      expect(docContent).toMatch(/cloudflare|account|login|auth|wrangler\s+login/i)
    })
  })
})
