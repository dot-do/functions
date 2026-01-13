/**
 * functions.do/csharp
 *
 * C#/.NET compilation for Functions.do
 * Uses thin stub + distributed runtime architecture for fast cold starts
 */

export { generateCSharpStub, type CSharpStubOptions } from './stub'
export { compileCSharp, type CSharpCompileOptions } from './roslyn'
export { CSharpRuntime, type CSharpRuntimeOptions, type CSharpMethod } from './runtime'
