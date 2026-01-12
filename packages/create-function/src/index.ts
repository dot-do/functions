#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SUPPORTED_LANGUAGES = ['typescript', 'rust', 'python', 'go', 'assemblyscript'] as const
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

interface ParsedArgs {
  projectName: string | undefined
  lang: string | undefined
}

function parseArgs(args: string[]): ParsedArgs {
  let projectName: string | undefined
  let lang: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--lang' && i + 1 < args.length) {
      lang = args[i + 1]
      i++ // Skip the next arg since we consumed it
    } else if (!arg.startsWith('-') && !projectName) {
      projectName = arg
    }
  }

  return { projectName, lang }
}

function getCompatibilityDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTemplateDir(lang: SupportedLanguage): string {
  // In development (from src), templates are at ../templates
  // In production (from dist), templates are at ../templates
  const templatesDir = join(__dirname, '..', 'templates', lang)
  if (existsSync(templatesDir)) {
    return templatesDir
  }

  // Fallback for when running from dist directory
  const distTemplatesDir = join(__dirname, '..', '..', 'templates', lang)
  if (existsSync(distTemplatesDir)) {
    return distTemplatesDir
  }

  throw new Error(`Template directory not found for language: ${lang}`)
}

function processTemplateContent(content: string, projectName: string, compatibilityDate: string): string {
  return content
    .replace(/\{\{project_name\}\}/g, projectName)
    .replace(/\{\{compatibility_date\}\}/g, compatibilityDate)
}

function copyTemplateRecursive(
  srcDir: string,
  destDir: string,
  projectName: string,
  compatibilityDate: string
): void {
  const entries = readdirSync(srcDir)

  for (const entry of entries) {
    const srcPath = join(srcDir, entry)
    const destPath = join(destDir, entry)
    const stat = statSync(srcPath)

    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyTemplateRecursive(srcPath, destPath, projectName, compatibilityDate)
    } else {
      // Read file content and process template variables
      const content = readFileSync(srcPath, 'utf-8')
      const processedContent = processTemplateContent(content, projectName, compatibilityDate)
      writeFileSync(destPath, processedContent)
    }
  }
}

function isValidLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage)
}

function main() {
  const args = process.argv.slice(2)
  const { projectName, lang } = parseArgs(args)

  if (!projectName) {
    console.error('Error: Project name is required')
    console.error('Usage: npx create-function <project-name> --lang <language>')
    console.error(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`)
    process.exit(1)
  }

  if (!lang) {
    console.error('Error: --lang flag is required')
    console.error('Usage: npx create-function <project-name> --lang <language>')
    console.error(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`)
    process.exit(1)
  }

  if (!isValidLanguage(lang)) {
    console.error(`Error: Unsupported language "${lang}".`)
    console.error(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`)
    process.exit(1)
  }

  const projectDir = join(process.cwd(), projectName)

  // Check if directory already exists
  if (existsSync(projectDir)) {
    console.error(`Error: Directory "${projectName}" already exists`)
    process.exit(1)
  }

  // Get template directory
  const templateDir = getTemplateDir(lang)
  const compatibilityDate = getCompatibilityDate()

  // Create project directory
  mkdirSync(projectDir, { recursive: true })

  // Copy template files with variable substitution
  copyTemplateRecursive(templateDir, projectDir, projectName, compatibilityDate)

  console.log(`Created ${projectName} successfully!`)
  console.log()
  console.log('Next steps:')
  console.log(`  cd ${projectName}`)

  // Language-specific next steps
  switch (lang) {
    case 'typescript':
    case 'assemblyscript':
      console.log('  npm install')
      console.log('  npm run dev')
      break
    case 'rust':
      console.log('  # Ensure you have Rust and wasm-pack installed')
      console.log('  wrangler dev')
      break
    case 'python':
      console.log('  # Ensure you have Python 3.11+ installed')
      console.log('  wrangler dev')
      break
    case 'go':
      console.log('  # Ensure you have Go and TinyGo installed')
      console.log('  go mod tidy')
      console.log('  make build')
      console.log('  wrangler dev')
      break
  }
}

main()
