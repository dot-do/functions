/**
 * Type definitions for the Functions.do SDK
 *
 * Re-exports types from the SDK compiler module for use by consumers.
 *
 * @module types
 */

/**
 * Represents a function parameter with its type information
 */
export interface FunctionParameter {
  /** Parameter name */
  name: string
  /** TypeScript type annotation */
  type: string
  /** Whether the parameter is optional */
  optional: boolean
  /** JSDoc description for this parameter */
  description?: string
  /** Default value if any */
  defaultValue?: string
}

/**
 * Represents a function signature extracted from source code
 */
export interface FunctionSignature {
  /** Function name */
  name: string
  /** Function parameters */
  params: FunctionParameter[]
  /** Return type */
  returnType: string
  /** Whether the function is async */
  isAsync: boolean
  /** JSDoc description */
  description?: string
  /** JSDoc tags (param, returns, example, etc.) */
  jsdocTags?: JsDocTag[]
  /** Whether this is a method on a class */
  isMethod?: boolean
  /** Parent class name if this is a method */
  className?: string
}

/**
 * JSDoc tag parsed from comments
 */
export interface JsDocTag {
  /** Tag name (param, returns, example, etc.) */
  tag: string
  /** Tag name/identifier (for @param tags) */
  name?: string
  /** Tag type (for @param and @returns tags) */
  type?: string
  /** Tag description */
  description?: string
}

/**
 * Result of type definition generation
 */
export interface TypeDefinitionResult {
  /** Generated .d.ts content */
  dts: string
  /** Extracted function signatures */
  signatures: FunctionSignature[]
  /** Any errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * Result of capnweb bindings generation
 */
export interface RpcBindingsResult {
  /** Generated RpcTarget class code */
  code: string
  /** Generated type definitions for the bindings */
  dts: string
  /** Errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * Configuration for ESM bundle production
 */
export interface BundleConfig {
  /** Entry point file path */
  entryPoint: string
  /** Output file path */
  outFile: string
  /** Whether to minify the output */
  minify?: boolean
  /** External packages to exclude from bundling */
  external?: string[]
  /** Whether to generate source maps */
  sourcemap?: boolean
  /** Additional esbuild options */
  esbuildOptions?: Record<string, unknown>
}

/**
 * Result of ESM bundle production
 */
export interface BundleResult {
  /** Path to the generated bundle */
  outputPath: string
  /** Bundle size in bytes */
  size: number
  /** Source map path if generated */
  sourceMapPath?: string
  /** Errors encountered */
  errors?: Array<{ message: string }>
}

/**
 * API documentation entry
 */
export interface ApiDocEntry {
  /** Function/method name */
  name: string
  /** Function signature string */
  signature: string
  /** Description from JSDoc */
  description?: string
  /** Parameters documentation */
  params: Array<{
    name: string
    type: string
    description?: string
    optional: boolean
  }>
  /** Return type and description */
  returns?: {
    type: string
    description?: string
  }
  /** Example code snippets */
  examples?: string[]
  /** Whether this is deprecated */
  deprecated?: string
  /** Since version */
  since?: string
}

/**
 * Generated API documentation
 */
export interface ApiDocumentation {
  /** Module/package name */
  name: string
  /** Module description */
  description?: string
  /** Version */
  version?: string
  /** API entries */
  entries: ApiDocEntry[]
}
