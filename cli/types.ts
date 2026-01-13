/**
 * CLI Types for dotdo
 *
 * This file defines the types used by the CLI commands.
 * Part of TDD RED phase - types are defined but implementation doesn't exist yet.
 */

/**
 * Mock filesystem interface for dependency injection
 * Allows testing without actual filesystem operations
 */
export interface MockFS {
  readFile: (path: string) => Promise<string>
  readFileBytes: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<{
    size: number
    mode: number
    mtime: number
    type: 'file' | 'directory' | 'symlink'
  }>
}

/**
 * CLI context for dependency injection
 */
export interface CLIContext {
  fs: MockFS
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
  cwd: string
}

/**
 * Result of executing a CLI command
 */
export interface CommandResult {
  exitCode: number
  output?: string
  error?: string
}

/**
 * Supported project templates/languages
 */
export type ProjectTemplate = 'typescript' | 'rust' | 'go' | 'python'

/**
 * Options for the init command
 */
export interface InitOptions {
  /**
   * The template/language to use for the project
   * Defaults to 'typescript' if not specified
   */
  template?: ProjectTemplate

  /**
   * Force creation even if directory exists
   */
  force?: boolean
}

/**
 * Project configuration stored in wrangler.toml
 */
export interface WranglerConfig {
  name: string
  main: string
  compatibility_date: string
  compatibility_flags?: string[]
  build?: {
    command: string
    cwd?: string
    watch_dir?: string
  }
  vars?: Record<string, string>
}

/**
 * Package.json structure for TypeScript projects
 */
export interface PackageJson {
  name: string
  version: string
  type: 'module'
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Template file definition
 */
export interface TemplateFile {
  path: string
  content: string | ((name: string) => string)
}

/**
 * Template definition for a project type
 */
export interface ProjectTemplateDefinition {
  name: ProjectTemplate
  displayName: string
  files: TemplateFile[]
  nextSteps: (projectName: string) => string[]
}
